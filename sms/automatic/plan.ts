// Pure shared financial plan. Also bundled for JavaScriptCore in the iOS App Intent.
import { parseSms, generateSmsFingerprint, matchWalletForCandidate, detectProvider } from '../index';
import { classifyMessage } from '../classifier';
import { correlateTransfer } from '../transferCorrelator';
import { detectProviderFromText } from '../../utils/accountRegistry';
import { parseSantim } from '../cleaners';
import { recognizeMerchant } from '../../utils/merchantRecognizer';
import { recognizeEducationPayment } from '../../utils/educationRecognizer';
import { transactionInsert, type SqlCommand } from '../../db/transactionSql';
import type { Wallet } from '../../types/Wallet';
import type { Transaction } from '../../types/Transaction';
import type { Category } from '../../types/Category';
import type { KnownAccount, Merchant, MerchantRule, EducationInstitution } from '../../types/FinancialRelationships';
import type { ParsedTransactionCandidate } from '../types';

export interface IncomingSms { id: string; body: string; sender: string; receivedAt: number; source?: string }
export interface ImportContext {
    wallets: Wallet[]; categories: Category[]; knownAccounts: KnownAccount[];
    merchants: Merchant[]; merchantRules: MerchantRule[]; educationInstitutions: EducationInstitution[];
}
export interface ImportPlan {
    status: 'imported' | 'review' | 'skipped'; reason: string;
    candidate?: ParsedTransactionCandidate; transaction?: Transaction; commands: SqlCommand[];
}
export const RECEIPTS_SCHEMA = `CREATE TABLE IF NOT EXISTS sms_import_receipts (
    message_key TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, created_at TEXT NOT NULL
);`;
export function cents(amount: number): number {
    const value = parseSantim(String(amount));
    if (value == null || !Number.isSafeInteger(value)) throw new Error('Invalid monetary amount');
    return value;
}

export function isFinancialMessage(body: string, sender = ''): boolean {
    if (!body || body.length > 16000 || classifyMessage(body).isNonTransaction) return false;
    if (/\b(?:otp\d*|one[ -]time\s+(?:password|code)|verification\s+code|security\s+code|secret\s+code|authentication\s+code)\b/i.test(body)) return false;
    const financial = /\b(?:ETB|birr|credited|debited|withdrawn|deposited|e-money)\b|ብር/i.test(body);
    const event = /\b(?:received|transferred|paid|bought|payment|debit|debited|credit|credited|withdraw|withdrawn|withdrawal|deposited|deposit|purchase|sent|transaction|balance)\b/i.test(body);
    const institution = detectProvider(body, sender) != null
        || /\b(?:your\s+(?:(?:current|available|e-money)\s+)*(?:account|balance)|you\s+have\s+(?:paid|received|transferred|withdrawn)|service\s+charge|reference)\b/i.test(body);
    return financial && event && institution;
}

export function buildImportPlan(message: IncomingSms, context: ImportContext): ImportPlan {
    const result = (status: ImportPlan['status'], reason: string, candidate?: ParsedTransactionCandidate): ImportPlan =>
        ({ status, reason, candidate, commands: [] });
    if (!isFinancialMessage(message.body, message.sender)) return result('skipped', 'Not a completed financial message');
    const parsed = parseSms(message.body, 'auto', message.sender);
    if (parsed.status !== 'parsed') return result(parsed.status === 'non_transaction' ? 'skipped' : 'review', parsed.reason);
    const candidate = parsed.candidate;
    if (!Number.isFinite(message.receivedAt) || message.receivedAt <= 0) return result('review', 'Missing message timestamp', candidate);
    if (!candidate.dateTime) candidate.dateTime = new Date(message.receivedAt).toISOString();
    const principal = cents(candidate.principalAmount);
    const ledger = cents(candidate.ledgerAmount);
    const fees = cents(candidate.fees?.totalFees ?? 0);
    if (principal <= 0 || ledger <= 0 || (candidate.type === 'DEBIT' && ledger !== principal + fees)) {
        return result('review', 'Amount or fee totals need confirmation', candidate);
    }
    if (candidate.warnings.some(w => /direction|amount.*(?:confirm|not found)|could not determine/i.test(w))) {
        return result('review', candidate.warnings.join(' '), candidate);
    }
    const match = matchWalletForCandidate(candidate, context.wallets);
    const wallet = match.matchedWallet;
    if (!wallet || (candidate.accountLast4 && wallet.accountNumberLast4 !== candidate.accountLast4)) {
        return result('review', 'Connect the matching financial account in Wallets, then retry', candidate);
    }
    const correlation = correlateTransfer(candidate, { existingTransactions: [], wallets: context.wallets, knownAccounts: context.knownAccounts });
    if (correlation.isOwnAccountTransfer || (candidate.type === 'CREDIT' && candidate.counterparty && detectProviderFromText(candidate.counterparty))) {
        return result('review', `Possible own-account transfer. Confirm its other leg before recording: ${correlation.reason}`, candidate);
    }
    const flow = candidate.type === 'DEBIT' ? 'EXPENSE' : 'INCOME';
    const education = recognizeEducationPayment(message.body, candidate.counterparty, context.educationInstitutions);
    const merchant = recognizeMerchant(candidate.counterparty || candidate.description, context.merchantRules, context.merchants);
    const categoryId = candidate.type === 'DEBIT'
        ? education.isEducation ? 'cat-5' : merchant.suggestedCategoryId || (/package|bundle|internet/i.test(candidate.description) ? 'cat-6' : 'cat-14')
        : 'cat-17';
    const category = context.categories.find(c => c.id === categoryId && c.flow === flow)
        || context.categories.find(c => c.flow === flow);
    if (!category) return result('review', 'A matching transaction category is required', candidate);
    const fingerprint = generateSmsFingerprint(candidate);
    const tx: Transaction = {
        id: `sms-${fingerprint}`, amount: principal / 100, type: candidate.type,
        walletId: wallet.id, categoryId: category.id, status: 'CLEARED', source: 'sms',
        date: candidate.dateTime, createdAt: new Date(message.receivedAt).toISOString(),
        note: candidate.description, counterparty: candidate.counterparty, currentBalance: candidate.currentBalance,
        smsReference: candidate.reference, smsFingerprint: fingerprint,
        feeAmount: fees / 100 || undefined, vatAmount: candidate.fees?.vat,
        merchantId: merchant.matchedRule?.merchantId, educationInstitutionId: education.matchedInstitution?.id,
    };
    const commands: SqlCommand[] = [transactionInsert(tx)];
    if (fees > 0 && candidate.type === 'DEBIT') {
        commands.push(transactionInsert({ ...tx, id: `${tx.id}-fee`, amount: fees / 100, subType: 'FEE',
            note: feeDescription(candidate) || `Fees: ${candidate.description}`, feeAmount: undefined, vatAmount: undefined,
            currentBalance: undefined, smsReference: undefined, smsFingerprint: undefined }));
    }
    commands.push({
        sql: 'UPDATE wallets SET balance = (ROUND(balance * 100) + ?) / 100.0 WHERE id = ?;',
        params: [candidate.type === 'DEBIT' ? -ledger : ledger, wallet.id],
    });
    commands.push({ sql: 'INSERT INTO sms_import_receipts(message_key, transaction_id, created_at) VALUES (?, ?, ?);',
        params: [message.id, tx.id, tx.createdAt] });
    return { status: 'imported', reason: 'Imported on device', candidate, transaction: tx, commands };
}

export function feeDescription(candidate: ParsedTransactionCandidate): string {
    const fees = candidate.fees;
    if (!fees) return '';
    const components: [string, number | undefined][] = [
        ['Service charge', fees.serviceCharge], ['VAT', fees.vat],
        ['Disaster recovery', fees.disasterFund], ['Other fees', fees.otherFees],
    ];
    return components.filter(([,amount]) => amount != null && amount > 0)
        .map(([label,amount]) => `${label}: ETB ${amount!.toFixed(2)}`).join('; ');
}

export function duplicateQuery(plan: ImportPlan): SqlCommand {
    const tx = plan.transaction!;
    return { sql: `SELECT id FROM transactions WHERE id = ? OR sms_fingerprint = ?
        OR (sms_reference = ? COLLATE NOCASE AND wallet_id = ? AND type = ?) LIMIT 1;`,
        params: [tx.id, tx.smsFingerprint!, tx.smsReference ?? null, tx.walletId, tx.type] };
}
