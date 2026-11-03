// Transport and Scriptable adapter rules only. Financial decisions stay in automatic/plan.
import { buildImportPlan, isFinancialMessage, cents, type ImportContext, type IncomingSms } from '../automatic/plan';
import { generateSmsFingerprint, normalizeSmsText, parseSms } from '../index';
import { sha256 } from '@noble/hashes/sha2.js';
import { defaultCategories } from '../../constants/defaultCategories';

export const FORMAT = 'bankoni.scriptable.sms';
export const VERSION = 1;
export const MAX_BATCH = 200;
export const MAX_FILE = 5 * 1024 * 1024;
export const emptyContext: ImportContext = { wallets: [], categories: defaultCategories, knownAccounts: [], merchants: [], merchantRules: [], educationInstitutions: [] };
export interface Evidence { body: string; sender: string; receivedAt: number }
export interface CompanionRecord extends IncomingSms { status: 'pending' | 'review' | 'failed'; reason: string; fingerprint?: string; summary?: { provider: string; direction: string; principalSantim: number; ledgerSantim: number; feesSantim: number; reference?: string; balanceSantim?: number; accountLast4?: string; date?: string } }
export interface Envelope { format: typeof FORMAT; version: 1; kind: 'transactions' | 'failed'; batchId: string; createdAt: string; records: CompanionRecord[] }

export function digest(value: string): string {
    // Pass explicit UTF-8 bytes: Scriptable need not provide TextEncoder or Web Crypto.
    const bytes = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
    return Array.from(sha256(Uint8Array.from(bytes, char => char.charCodeAt(0))), byte => byte.toString(16).padStart(2,'0')).join('');
}
export function messageId(message: Evidence): string {
    return 'sc-' + digest(JSON.stringify([message.sender.trim().toLowerCase(), normalizeSmsText(message.body).replace(/\s+/g, ' '), message.receivedAt]));
}
export function normalizeEvidence(input: unknown): Evidence {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected a message dictionary with body, sender and receivedAt');
    const row = input as Record<string, unknown>;
    if (typeof row.body !== 'string' || !row.body.trim() || row.body.length > 16000) throw Error('Message body must contain 1–16,000 characters');
    if (typeof row.sender !== 'string' || row.sender.length > 128) throw Error('Sender must be text, at most 128 characters (blank is allowed)');
    try { encodeURIComponent(row.body); encodeURIComponent(row.sender); } catch { throw Error('Message contains invalid Unicode text'); }
    const time = typeof row.receivedAt === 'number' ? row.receivedAt : typeof row.receivedAt === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(row.receivedAt) ? Date.parse(row.receivedAt) : NaN;
    // Invalid dates remain review evidence. Never silently substitute today's date for history.
    let validCalendar = true;
    if (typeof row.receivedAt === 'string') {
        const parts = /^(\d{4})-(\d{2})-(\d{2})T/.exec(row.receivedAt);
        validCalendar = !!parts && +parts[2] >= 1 && +parts[2] <= 12 && +parts[3] >= 1 && +parts[3] <= new Date(Date.UTC(+parts[1],+parts[2],0)).getUTCDate();
    }
    const receivedAt = validCalendar && Number.isFinite(time) && time >= Date.UTC(2000,0,1) && time <= Date.now() + 86400000 ? time : 0;
    return { body: row.body.trim(), sender: row.sender.trim(), receivedAt };
}
export function analyse(message: Evidence, context: ImportContext = emptyContext): CompanionRecord | null {
    if (!isFinancialMessage(message.body, message.sender)) return null;
    const id = messageId(message);
    const base = { ...message, id, source: 'scriptable' };
    try {
        const plan = buildImportPlan(base, context);
        if (plan.status === 'skipped') return null;
        const candidate = plan.candidate;
        return { ...base, status: plan.status === 'imported' ? 'pending' : 'review', reason: plan.reason,
            fingerprint: candidate ? generateSmsFingerprint(candidate) : undefined,
            summary: candidate ? { provider: candidate.providerId, direction: candidate.type, principalSantim: cents(candidate.principalAmount), ledgerSantim: cents(candidate.ledgerAmount), feesSantim: cents(candidate.fees?.totalFees ?? 0), reference: candidate.reference, balanceSantim: candidate.currentBalance == null ? undefined : cents(candidate.currentBalance), accountLast4: candidate.accountLast4, date: candidate.dateTime } : undefined };
    } catch { return { ...base, status: 'failed', reason: 'The local parser could not process this message. Keep the evidence and retry after updating BanKoni.' }; }
}
export function parseInput(input: unknown): { mode: string; messages: unknown[]; id?: string; kind?: string; start?: number; end?: number } {
    if (typeof input === 'string') {
        if (!input.trim() || input.length > MAX_FILE) throw Error('Shortcut input is empty or exceeds 5 MB');
        try { input = JSON.parse(input); } catch { throw Error('Shortcut input must be a dictionary or JSON, not an unstructured message'); }
    }
    if (input == null) return { mode: 'dashboard', messages: [] };
    if (typeof input !== 'object' || Array.isArray(input)) throw Error('Expected a Shortcut dictionary');
    const obj = input as Record<string, unknown>;
    if (obj.version !== VERSION) throw Error('Unsupported Shortcut input version; update the Shortcut to version 1');
    const mode = obj.mode as string;
    if (!['history_import','incoming_message','retry_failed','export_pending','dashboard'].includes(mode)) throw Error('Unsupported processing mode');
    let messages: unknown[] = [];
    if (mode === 'incoming_message') messages = [obj.message];
    if (mode === 'history_import') {
        if (!Array.isArray(obj.messages)) throw Error('History input needs a messages list');
        messages = obj.messages;
    }
    if ((mode === 'incoming_message' || mode === 'history_import') && !messages.length) throw Error('No messages were supplied');
    if (messages.length > MAX_BATCH) throw Error('Send at most 200 messages per call; split the history into smaller batches');
    const start = obj.start == null ? undefined : Date.parse(String(obj.start));
    const end = obj.end == null ? undefined : Date.parse(String(obj.end));
    if ((start != null && !Number.isFinite(start)) || (end != null && !Number.isFinite(end)) || (start != null && end != null && start > end)) throw Error('Invalid historical date range');
    return { mode, messages, id: typeof obj.id === 'string' ? obj.id : undefined, kind: obj.kind === 'failed' ? 'failed' : 'transactions', start, end };
}
export function makeEnvelope(records: CompanionRecord[], kind: Envelope['kind'] = 'transactions', now = Date.now()): Envelope {
    const sorted = [...records].sort((a,b) => a.id.localeCompare(b.id));
    const batchId = 'batch-' + digest(JSON.stringify([kind, sorted.map(r => [r.id,r.status])]));
    return { format: FORMAT, version: VERSION, kind, batchId, createdAt: new Date(now).toISOString(), records: sorted };
}
/** Imported preview amounts/SQL/IDs are never trusted. Only validated evidence is returned. */
export function readEnvelope(raw: string): { envelope: Envelope; records: CompanionRecord[]; errors: { index: number; reason: string }[]; skipped: number } {
    if (raw.length > MAX_FILE) throw Error('Choose an export smaller than 5 MB');
    let value: any;
    try { value = JSON.parse(raw); } catch { throw Error('The export is not valid JSON'); }
    if (!value || value.format !== FORMAT || value.version !== VERSION || !['transactions','failed'].includes(value.kind) || typeof value.batchId !== 'string' || !/^batch-[a-f0-9]{64}$/.test(value.batchId) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.records) || value.records.length > MAX_BATCH) throw Error('Unsupported or invalid BanKoni companion export (version 1, at most 200 records)');
    const records: CompanionRecord[] = [], errors: {index: number; reason: string}[] = [];
    let skipped = 0;
    value.records.forEach((row: unknown, index: number) => {
        try { const message = normalizeEvidence(row); const record = analyse(message); if (record) records.push(record); else skipped++; }
        catch (error) { errors.push({index,reason:error instanceof Error ? error.message : 'Invalid message'}); }
    });
    return { envelope: value, records, errors, skipped };
}
export function readContext(raw: string): ImportContext {
    if (raw.length > MAX_FILE) throw Error('Account context exceeds 5 MB');
    const data = JSON.parse(raw);
    if (data?.format !== 'bankoni.scriptable.context' || data.version !== VERSION || !Array.isArray(data.wallets) || data.wallets.length > 100 || !Array.isArray(data.categories) || data.categories.length > 1000 || !Array.isArray(data.knownAccounts) || data.knownAccounts.length > 1000) throw Error('Choose a BanKoni account-context version 1 export');
    for (const wallet of data.wallets) if (typeof wallet.id !== 'string' || typeof wallet.providerId !== 'string' || wallet.currency !== 'ETB' || (wallet.accountNumberLast4 != null && !/^\d{4}$/.test(wallet.accountNumberLast4))) throw Error('Invalid wallet context');
    // Preview-only context; the app always reloads authoritative accounts/categories on import.
    return { ...emptyContext, wallets: data.wallets, categories: data.categories, knownAccounts: data.knownAccounts };
}
export { buildImportPlan, isFinancialMessage, parseSms };
