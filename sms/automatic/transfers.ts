import { parseSms, matchWalletForCandidate, generateSmsFingerprint } from '../index';
import { correlateTransfer } from '../transferCorrelator';
import { cents, feeDescription, type ImportContext, type IncomingSms } from './plan';
import { createTransferDB } from '../../db/database';
import { detectProviderFromText } from '../../utils/accountRegistry';

export function transferSuggestion(debit: IncomingSms, credit: IncomingSms, context: ImportContext) {
    const d = parseSms(debit.body, 'auto', debit.sender);
    const c = parseSms(credit.body, 'auto', credit.sender);
    if (d.status !== 'parsed' || c.status !== 'parsed' || d.candidate.type !== 'DEBIT' || c.candidate.type !== 'CREDIT') return null;
    const from = matchWalletForCandidate(d.candidate, context.wallets).matchedWallet;
    const to = matchWalletForCandidate(c.candidate, context.wallets).matchedWallet;
    if (!from || !to || from.id === to.id || (d.candidate.accountLast4 && from.accountNumberLast4 !== d.candidate.accountLast4)
        || (c.candidate.accountLast4 && to.accountNumberLast4 !== c.candidate.accountLast4)) return null;
    const principal = cents(d.candidate.principalAmount);
    const fees = cents(d.candidate.fees?.totalFees ?? 0);
    if (principal <= 0 || principal !== cents(c.candidate.principalAmount) || cents(d.candidate.ledgerAmount) !== principal + fees) return null;
    const dateD = d.candidate.dateTime || new Date(debit.receivedAt).toISOString();
    const dateC = c.candidate.dateTime || new Date(credit.receivedAt).toISOString();
    if (Math.abs(Date.parse(dateD) - Date.parse(dateC)) > 10 * 60000) return null;
    const correlation = correlateTransfer(c.candidate, { ...context, existingTransactions: [] });
    if (!correlation.isOwnAccountTransfer || detectProviderFromText(c.candidate.counterparty || '') !== from.providerId) return null;
    return { from, to, principal, fees, debit: { ...d.candidate, dateTime: dateD }, credit: { ...c.candidate, dateTime: dateC } };
}

/** Must only be called after the user confirms the two displayed pieces of evidence. */
export async function confirmQueuedTransfer(debit: IncomingSms, credit: IncomingSms, context: ImportContext) {
    const suggestion = transferSuggestion(debit, credit, context);
    if (!suggestion) throw new Error('These messages do not form a supported transfer suggestion');
    const fromFingerprint = generateSmsFingerprint(suggestion.debit);
    const toFingerprint = generateSmsFingerprint(suggestion.credit);
    return createTransferDB({
        fromWalletId: suggestion.from.id, toWalletId: suggestion.to.id,
        amount: suggestion.principal / 100, feeAmount: suggestion.fees / 100,
        date: suggestion.debit.dateTime, fromSmsReference: suggestion.debit.reference,
        toSmsReference: suggestion.credit.reference, source: 'sms',
        note: ['Own-account transfer confirmed from two SMS messages', feeDescription(suggestion.debit)].filter(Boolean).join('; '),
        smsImport: { id: `tr-sms-${fromFingerprint}-${toFingerprint}`, fromFingerprint, toFingerprint, messageKeys: [debit.id, credit.id], vatAmount: suggestion.debit.fees?.vat },
    });
}
