import { isFinancialMessage } from './plan';
import { selectedSource, rollingImportWindow, type FinancialSource } from '../sources';
import { resolveEventTime } from '../eventTime';
import { parseManualEventDate } from '../eventTime';
import { detectProvider } from '../providers/detector';
export interface ExportedMessage { body: string; sender: string; receivedAt: number }
/** Explicitly user-selected JSON export, not direct iOS inbox access. */
export function readExportedMessages(raw: string, now = Date.now(), sources?: FinancialSource[]): ExportedMessage[] {
    if (raw.length > 5 * 1024 * 1024) throw new Error('Choose a JSON export smaller than 5 MB');
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Expected an array of at most 10,000 messages');
    const start = new Date(rollingImportWindow(now).start);
    return rows.flatMap(row => {
        if (!row || typeof row.body !== 'string' || typeof row.sender !== 'string') return [];
        if (sources && !selectedSource(row.sender, sources, undefined, false)) return [];
        let receivedAt = typeof row.receivedAt === 'number' ? row.receivedAt : Date.parse(row.receivedAt);
        const isCbe=detectProvider(row.body,row.sender)==='cbe';
        if(isCbe && typeof row.receivedAt==='string')receivedAt=parseManualEventDate(row.receivedAt,now) ?? 0;
        if (!isFinancialMessage(row.body,row.sender)) return [];
        if (!Number.isSafeInteger(receivedAt) || receivedAt < Date.UTC(2000,0,1) || receivedAt > now + 300000) receivedAt=0;
        if (receivedAt > 0 && (receivedAt < start.getTime() || receivedAt > now)) return [];
        const event = resolveEventTime(row.body, receivedAt, undefined, now,isCbe ? 'cbe':undefined);
        // Invalid event dates are retained for manual review, never silently assigned today.
        if (event.valid && (event.occurredAt < start.getTime() || event.occurredAt > now)) return [];
        return [{ body: row.body, sender: row.sender.slice(0,128), receivedAt }];
    });
}
