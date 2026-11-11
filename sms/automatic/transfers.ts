import { parseSms, matchWalletForCandidate, generateSmsFingerprint } from '../index';
import { correlateTransfer } from '../transferCorrelator';
import { cents, feeDescription, type ImportContext, type IncomingSms } from './plan';
import { createTransferDB } from '../../db/database';
import { detectProviderFromText } from '../../utils/accountRegistry';
import { resolveEventTime } from '../eventTime';
import { selectedSource } from '../sources';
import { buildReviewedCbePlan } from '../cbeReview';
import { cbeCompatibleFingerprints } from '../fingerprint';
const parsedCache = new WeakMap<IncomingSms, ReturnType<typeof parseSms>>();
function parsedMessage(message: IncomingSms) {
    let parsed = parsedCache.get(message);
    if (!parsed) { parsed = parseSms(message.body, 'auto', message.sender); parsedCache.set(message, parsed); }
    return parsed;
}

export function transferSuggestion(debit: IncomingSms, credit: IncomingSms, context: ImportContext) {
    const debitSource = context.sources ? selectedSource(debit.sender, context.sources, context.wallets, debit.source === 'live') : undefined;
    const creditSource = context.sources ? selectedSource(credit.sender, context.sources, context.wallets, credit.source === 'live') : undefined;
    if (context.sources && (!debitSource || !creditSource || debit.walletId !== debitSource.walletId || credit.walletId !== creditSource.walletId)) return null;
    const d = parsedMessage(debit);
    const c = parsedMessage(credit);
    if (d.status !== 'parsed' || c.status !== 'parsed' || d.candidate.type !== 'DEBIT' || c.candidate.type !== 'CREDIT') return null;
    const from = debitSource ? context.wallets.find(w => w.id === debitSource.walletId) : matchWalletForCandidate(d.candidate, context.wallets).matchedWallet;
    const to = creditSource ? context.wallets.find(w => w.id === creditSource.walletId) : matchWalletForCandidate(c.candidate, context.wallets).matchedWallet;
    if (!from || !to || from.id === to.id || (d.candidate.accountLast4 && from.accountNumberLast4 !== d.candidate.accountLast4)
        || (c.candidate.accountLast4 && to.accountNumberLast4 !== c.candidate.accountLast4)) return null;
    const principal = cents(d.candidate.principalAmount);
    const fees = cents(d.candidate.fees?.totalFees ?? 0);
    if (principal <= 0 || principal !== cents(c.candidate.principalAmount) || cents(d.candidate.ledgerAmount) !== principal + fees) return null;
    const timeD = resolveEventTime(debit.body, debit.receivedAt, d.candidate.dateTime,Date.now(),d.candidate.providerId);
    const timeC = resolveEventTime(credit.body, credit.receivedAt, c.candidate.dateTime,Date.now(),c.candidate.providerId);
    if (!timeD.valid || !timeC.valid || timeD.datePrecision === 'day' || timeC.datePrecision === 'day') return null;
    const dateD = d.candidate.dateTime && Date.parse(d.candidate.dateTime) === timeD.occurredAt ? d.candidate.dateTime : new Date(timeD.occurredAt).toISOString();
    const dateC = c.candidate.dateTime && Date.parse(c.candidate.dateTime) === timeC.occurredAt ? c.candidate.dateTime : new Date(timeC.occurredAt).toISOString();
    if (Math.abs(Date.parse(dateD) - Date.parse(dateC)) > 10 * 60000) return null;
    const correlation = correlateTransfer(c.candidate, { ...context, existingTransactions: [] });
    if (!correlation.isOwnAccountTransfer || detectProviderFromText(c.candidate.counterparty || '') !== from.providerId) return null;
    return { from, to, principal, fees, fromDateSource:timeD.dateSource, toDateSource:timeC.dateSource, fromDatePrecision:timeD.datePrecision,toDatePrecision:timeC.datePrecision, debit: { ...d.candidate, dateTime: dateD }, credit: { ...c.candidate, dateTime: dateC } };
}

/** Must only be called after the user confirms the two displayed pieces of evidence. */
export async function confirmQueuedTransfer(debit: IncomingSms, credit: IncomingSms, context: ImportContext) {
    const suggestion = transferSuggestion(debit, credit, context);
    if (!suggestion) throw new Error('These messages do not form a supported transfer suggestion');
    const fromFingerprint = generateSmsFingerprint(suggestion.debit);
    const toFingerprint = generateSmsFingerprint(suggestion.credit);
    const validateCbe=(message:IncomingSms,walletId:string,candidate:typeof suggestion.debit)=>{
        if(candidate.providerId!=='cbe')return undefined;
        const category=context.categories.find(c=>c.flow===(candidate.type==='DEBIT' ? 'EXPENSE':'INCOME'));
        const plan=buildReviewedCbePlan({...message,walletId,providerId:'cbe'},context,{amountInput:String(candidate.ledgerAmount),eventDateInput:candidate.dateTime!,direction:candidate.type,walletId,categoryId:category?.id ?? '',authorized:true,treatment:'transfer',transferWalletId:walletId===suggestion.from.id ? suggestion.to.id:suggestion.from.id});
        if(plan.status!=='imported')throw Error(plan.reason);
        return plan.transaction!.smsDetails;
    };
    const fromCbeDetails=validateCbe(debit,suggestion.from.id,suggestion.debit);
    const toCbeDetails=validateCbe(credit,suggestion.to.id,suggestion.credit);
    return createTransferDB({
        fromWalletId: suggestion.from.id, toWalletId: suggestion.to.id,
        amount: suggestion.principal / 100, feeAmount: suggestion.fees / 100,
        date: suggestion.debit.dateTime, fromSmsReference: suggestion.debit.reference,
        toSmsReference: suggestion.credit.reference, source: 'sms',
        note: ['Own-account transfer confirmed from two SMS messages', feeDescription(suggestion.debit)].filter(Boolean).join('; '),
        smsImport: { id: `tr-sms-${fromFingerprint}-${toFingerprint}`, fromFingerprint, toFingerprint, messageKeys: [debit.id, credit.id], vatAmount: suggestion.debit.fees?.vat,
            fromCbeDetails,toCbeDetails,fromCompatibleFingerprints:fromCbeDetails ? cbeCompatibleFingerprints(suggestion.debit):undefined,toCompatibleFingerprints:toCbeDetails ? cbeCompatibleFingerprints(suggestion.credit):undefined,
            fromReceivedAt:debit.receivedAt,toReceivedAt:credit.receivedAt,fromEventDate:suggestion.debit.dateTime,toEventDate:suggestion.credit.dateTime,
            fromDateSource:suggestion.fromDateSource,toDateSource:suggestion.toDateSource,fromDatePrecision:suggestion.fromDatePrecision,toDatePrecision:suggestion.toDatePrecision },
    });
}
