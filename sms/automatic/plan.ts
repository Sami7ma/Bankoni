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
import { selectedSource, rollingImportWindow, type FinancialSource } from '../sources';
import { resolveEventTime } from '../eventTime';
import { parseManualEventInput, validReceivedTimestamp } from '../eventTime';
import { parseMoneyInput } from '../../utils/money';
import { cbeCompatibleFingerprints, smsEvidenceHash } from '../fingerprint';

export interface IncomingSms { id: string; body: string; sender: string; receivedAt: number; source?: string;
    walletId?: string; providerId?: string; windowStart?: number; windowEnd?: number; hasTransportIdentity?: boolean }
export interface ImportContext {
    wallets: Wallet[]; categories: Category[]; knownAccounts: KnownAccount[];
    merchants: Merchant[]; merchantRules: MerchantRule[]; educationInstitutions: EducationInstitution[];
    sources?: FinancialSource[];
    /** Ownership evidence remains complete when an account import narrows eligible destinations. */
    ownershipWallets?: Wallet[];
    existingTransactions?:Transaction[];
}
export interface ValidatedFinancialMessage {
    provider: string; senderId: string; destinationAccount: string; reference?: string;
    amountMinor: number; ledgerAmountMinor: number; feeMinor: number; currency: 'ETB';
    direction: 'debit' | 'credit'; type: string; counterparty?: string;
    occurredAt: number; receivedAt: number; importedAt: number;
    dateSource: import('../eventTime').DateSource; datePrecision: import('../eventTime').DatePrecision; eventDate?: string;
    confidence: 'validated'; missingFields: string[];
    accountLast4?:string; chargesMinor?:{serviceCharge:number;vat:number;disasterFund:number;otherFees:number};
    sourceEvidence?:{messageId:string;bodyHash:string;source:string}; reviewReasons?:string[];
}
/** Reviewed fields are assertions about fresh source parsing, never a replacement candidate. */
export interface CbeReviewFields {
    amountInput:string; eventDateInput:string; direction:'CREDIT'|'DEBIT'; walletId:string;
    categoryId:string; note?:string; authorized:boolean; treatment:'ordinary'|'transfer';
    transferWalletId?:string;
}
export interface CbeBalanceCheckpoint {id:string;walletId:string;accountLast4:string;balanceMinor:number;observedAt:number;receivedAt:number;dateSource:string;datePrecision:string}
export interface ImportPlan {
    balanceCheckpoint?:CbeBalanceCheckpoint;
    status: 'imported' | 'review' | 'skipped'; reason: string;
    candidate?: ParsedTransactionCandidate; transaction?: Transaction; commands: SqlCommand[];
    normalized?: ValidatedFinancialMessage;
    compatibleFingerprints?:string[];
    entries?:Transaction[];
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

export function buildImportPlan(message: IncomingSms, context: ImportContext, importedAt = Date.now(), review?:CbeReviewFields): ImportPlan {
    let balanceCheckpoint:CbeBalanceCheckpoint|undefined;
    const result = (status: ImportPlan['status'], reason: string, candidate?: ParsedTransactionCandidate): ImportPlan =>
        ({ status, reason, candidate, commands: [],...(balanceCheckpoint?{balanceCheckpoint}:{}) });
    const source = context.sources ? selectedSource(message.sender, context.sources, context.wallets, message.source === 'live') : undefined;
    // Automatic/native paths always require explicit authorization. Manual user-selected input
    // continues through the same rules without pretending to have Android inbox access.
    if ((context.sources || message.source === 'history' || message.source === 'live') && !source) return result('skipped', 'Sender is not selected and linked to an active account');
    if (source && (message.walletId !== source.walletId || message.providerId !== source.providerId)) return result('skipped', 'Source account configuration changed; this queued message is not authorized');
    if (!isFinancialMessage(message.body, message.sender)) return result('skipped', 'Not a completed financial message');
    const parsed = parseSms(message.body, source?.providerId ?? 'auto', message.sender);
    if (parsed.status !== 'parsed') return result(parsed.status === 'non_transaction' ? 'skipped' : 'review', parsed.reason);
    const candidate = parsed.candidate;
    if(review && candidate.providerId!=='cbe')return result('review','CBE review cannot validate another provider',candidate);
    if(candidate.providerId==='cbe') {
        const bodyProvider=detectProvider(message.body),senderProvider=detectProvider('',message.sender);
        if(/^CBE[ _-]*BIRR$/i.test(message.sender.trim()) || (bodyProvider && bodyProvider!=='cbe') || (senderProvider && senderProvider!=='cbe') || !message.sender.trim())return result('review','CBE provider and exact sender evidence disagree or sender is missing',candidate);
        if(message.providerId && message.providerId!=='cbe')return result('review','CBE queued provider binding disagrees',candidate);
        if(review && (!review.authorized || review.walletId!==message.walletId))return result('review','Explicit authorization for this exact sender and account is required',candidate);
    }
    let time = resolveEventTime(message.body, message.receivedAt, candidate.dateTime, importedAt, candidate.providerId);
    if(candidate.providerId==='cbe' && review) {
        const input=parseManualEventInput(review.eventDateInput,importedAt);
        if(input?.datePrecision==='day')input.iso=`${input.eventDate}T00:00:00+03:00`;
        if(!input || !validReceivedTimestamp(message.receivedAt,importedAt) || Date.parse(input.iso)>message.receivedAt+300000)return result('review','Verify event date and original SMS receive time; processing time is never substituted',candidate);
        const unchanged=time.valid && (time.datePrecision==='day' ? input.eventDate===time.eventDate : Date.parse(input.iso)===time.occurredAt);
        if(!unchanged)time={valid:true,occurredAt:Date.parse(input.iso),receivedAt:message.receivedAt,dateSource:'manual',datePrecision:input.datePrecision,eventDate:input.eventDate};
    }
    if (!time.valid) return result('review', time.reason, candidate);
    if (!review && !candidate.reference && time.dateSource === 'sms_received' && message.hasTransportIdentity === false) {
        return result('review', 'No provider reference, event date or shared delivery identifier; review to avoid a live/history duplicate', candidate);
    }
    // Retain the provider's existing ISO representation for legacy fingerprint compatibility.
    // The ledger event column is canonical epoch milliseconds regardless of string offset.
    if (!candidate.dateTime || Date.parse(candidate.dateTime) !== time.occurredAt) candidate.dateTime = new Date(time.occurredAt).toISOString();
    if (message.source === 'history' && (message.windowStart == null || message.windowEnd == null)) return result('review', 'Historical import period is missing', candidate);
    if(message.source==='history') {
        const current=rollingImportWindow(importedAt);
        const lower=candidate.providerId==='cbe' ? message.windowStart!:Math.max(message.windowStart!,current.start),upper=Math.min(message.windowEnd!,current.end);
        if(!Number.isSafeInteger(lower) || !Number.isSafeInteger(upper) || lower<Date.UTC(2000,0,1)-10800000 || lower>upper)return result('review','Invalid historical import period',candidate);
        if(time.datePrecision==='day') {
            const dayEnd=time.occurredAt+86400000;
            if(dayEnd<=lower || time.occurredAt>upper)return result('skipped','Transaction event date is outside the selected import period',candidate);
            if(time.occurredAt<lower || dayEnd>upper)return result('review','The date-only event overlaps the import boundary; confirm its time or import manually',candidate);
        } else if(time.occurredAt<lower || time.occurredAt>upper)return result('skipped','Transaction event is outside the selected import period',candidate);
    }
    if ((message.windowStart != null && time.occurredAt < message.windowStart) || (message.windowEnd != null && time.occurredAt > message.windowEnd)) return result('skipped', 'Transaction event is outside the selected import period', candidate);
    const principal = cents(candidate.principalAmount);
    const ledger = cents(candidate.ledgerAmount);
    const fees = cents(candidate.fees?.totalFees ?? 0);
    if(candidate.providerId==='cbe' && review && (parseMoneyInput(review.amountInput)!==ledger || review.direction!==candidate.type))return result('review','Reviewed amount/direction disagrees with the CBE evidence; correct the source or retain for review',candidate);
    if (principal <= 0 || ledger <= 0 || (candidate.type === 'DEBIT' && ledger !== principal + fees)) {
        return result('review', 'Amount or fee totals need confirmation', candidate);
    }
    if (candidate.automaticEligible === false || candidate.warnings.some(w => /direction|amount.*(?:confirm|not found)|could not determine|provisional|unrecognized template/i.test(w))) {
        return result('review', candidate.warnings.join(' '), candidate);
    }
    const match = matchWalletForCandidate(candidate, context.wallets);
    const wallet = source ? context.wallets.find(w => w.id === source.walletId) : candidate.providerId==='cbe' && message.walletId ? context.wallets.find(w=>w.id===message.walletId) : match.matchedWallet;
    if (!wallet || (candidate.accountLast4 && wallet.accountNumberLast4 !== candidate.accountLast4)) {
        return result('review', 'Connect the matching financial account in Wallets, then retry', candidate);
    }
    if(candidate.providerId==='cbe' && (wallet.isArchived || wallet.providerId!=='cbe' || wallet.currency!=='ETB' || !candidate.accountLast4 || wallet.accountNumberLast4!==candidate.accountLast4))return result('review','CBE provider, owned account identifier and ETB currency must match',candidate);
    if(candidate.providerId==='cbe' && candidate.currentBalance!=null)balanceCheckpoint={id:generateSmsFingerprint(candidate),walletId:wallet.id,accountLast4:candidate.accountLast4!,balanceMinor:cents(candidate.currentBalance),observedAt:time.occurredAt,receivedAt:time.receivedAt,dateSource:time.dateSource,datePrecision:time.datePrecision??'second'};
    if(candidate.providerId==='cbe' && candidate.type==='CREDIT' && candidate.sourceAccountLast4 && (context.ownershipWallets??context.wallets).some(w=>w.id!==wallet.id&&w.providerId==='cbe'&&w.currency==='ETB'&&!w.isArchived&&w.accountNumberLast4===candidate.sourceAccountLast4) && review?.treatment!=='transfer')return result('review','Incoming transfer from an owned CBE account: confirm the other leg, not income',candidate);
    const peer=review?.transferWalletId ? context.wallets.find(w=>w.id===review.transferWalletId && w.id!==wallet.id && !w.isArchived && w.currency==='ETB'):undefined;
    if(review?.treatment==='transfer' && !peer)return result('review','Select the other active ETB account you own before confirming a CBE transfer',candidate);
    if(review?.treatment==='transfer' && candidate.sourceAccountLast4 && (peer?.providerId!=='cbe'||peer.accountNumberLast4!==candidate.sourceAccountLast4))return result('review','CBE source account does not match the selected owned account',candidate);
    if(review?.treatment==='transfer' && candidate.destinationAccountLast4 && (peer?.providerId!=='cbe' || peer.accountNumberLast4!==candidate.destinationAccountLast4))return result('review','CBE destination account does not match the selected owned account',candidate);
    if(candidate.providerId==='cbe' && review?.treatment==='ordinary' && candidate.destinationAccountLast4 && (context.ownershipWallets??context.wallets).some(w=>w.id!==wallet.id && !w.isArchived && w.providerId==='cbe' && w.currency==='ETB' && w.accountNumberLast4===candidate.destinationAccountLast4))return result('review','This explicit destination is an owned account; confirm it as a transfer',candidate);
    if(candidate.providerId==='cbe' && !review && candidate.type==='CREDIT' && context.existingTransactions?.some(t=>t.walletId===wallet.id && t.isTransfer && t.type==='CREDIT' && t.smsDetails?.provider==='cbe' && t.amountMinor===principal && Math.abs((t.occurredAt ?? Date.parse(t.date))-time.occurredAt)<=600000 && (!candidate.reference || t.smsReference!==candidate.reference)))return result('review','This CBE credit may already be represented by a confirmed transfer; compare both pieces of evidence before posting',candidate);
    if (/\b(?:refund(?:ed)?|revers(?:al|ed))\b/i.test(message.body)) {
        return result('review', 'Refund or reversal: link and confirm the original transaction before applying it', candidate);
    }
    const correlation = correlateTransfer(candidate, { existingTransactions: [], wallets: candidate.providerId==='cbe' ? context.ownershipWallets??context.wallets:context.wallets, knownAccounts: context.knownAccounts });
    if (!review && (correlation.isOwnAccountTransfer || (candidate.type === 'CREDIT' && candidate.counterparty && detectProviderFromText(candidate.counterparty)))) {
        return result('review', `Possible own-account transfer. Confirm its other leg before recording: ${correlation.reason}`, candidate);
    }
    const flow = candidate.type === 'DEBIT' ? 'EXPENSE' : 'INCOME';
    const education = recognizeEducationPayment(message.body, candidate.counterparty, context.educationInstitutions);
    const merchant = recognizeMerchant(candidate.counterparty || candidate.description, context.merchantRules, context.merchants);
    if (!review && merchant.matchedRule && !merchant.matchedRule.autoApply) {
        return result('review', 'This merchant rule requires your confirmation before choosing a category', candidate);
    }
    const categoryId = candidate.type === 'DEBIT'
        ? education.isEducation ? 'cat-5' : merchant.suggestedCategoryId || (/package|bundle|internet/i.test(candidate.description) ? 'cat-6' : 'cat-14')
        : 'cat-17';
    const category = review ? context.categories.find(c=>c.id===review.categoryId && c.flow===flow) : context.categories.find(c => c.id === categoryId && c.flow === flow)
        || context.categories.find(c => c.flow === flow);
    if (!category) return result('review', 'A matching transaction category is required', candidate);
    const fingerprint = generateSmsFingerprint(candidate);
    const chargesMinor={serviceCharge:cents(candidate.fees?.serviceCharge ?? 0),vat:cents(candidate.fees?.vat ?? 0),disasterFund:cents(candidate.fees?.disasterFund ?? 0),otherFees:cents(candidate.fees?.otherFees ?? 0)};
    if(candidate.providerId==='cbe' && Object.values(chargesMinor).reduce((sum,n)=>sum+n,0)!==fees)return result('review','CBE charge components disagree',candidate);
    const sourceEvidence={messageId:message.id,bodyHash:smsEvidenceHash(message.body),source:message.source ?? 'manual'};
    const tx: Transaction = {
        id: `sms-${fingerprint}`, amount: principal / 100, type: candidate.type,
        walletId: wallet.id, categoryId: category.id, status: 'CLEARED', source: 'sms',
        date: new Date(time.occurredAt).toISOString(), createdAt: new Date(importedAt).toISOString(),
        amountMinor: principal, occurredAt: time.occurredAt, receivedAt: time.receivedAt,
        importedAt, dateSource: time.dateSource, datePrecision: time.datePrecision, eventDate: time.eventDate,
        note: candidate.description, counterparty: candidate.counterparty, currentBalance: candidate.currentBalance,
        smsReference: candidate.reference, smsFingerprint: fingerprint,
        feeAmount: fees / 100 || undefined, vatAmount: candidate.fees?.vat,
        merchantId: merchant.matchedRule?.merchantId, educationInstitutionId: education.matchedInstitution?.id,
        ...(candidate.providerId==='cbe' ? {
            isTransfer:review?.treatment==='transfer',subType:review?.treatment==='transfer' ? 'TRANSFER' as const:'STANDARD' as const,
            transferWalletId:peer?.id,
            note:review?.note?.trim() || candidate.description,
            smsDetails:{provider:'cbe' as const,senderId:message.sender,walletId:wallet.id,accountLast4:candidate.accountLast4!,principalMinor:principal,feeMinor:fees,ledgerMinor:ledger,chargesMinor,currency:'ETB' as const,direction:candidate.type,reference:candidate.reference,evidence:sourceEvidence,reviewReasons:[...candidate.warnings,...(review ? ['Explicit financial review',...(time.dateSource==='manual' ? ['Event date confirmed manually']:[])]:[])],reportingTimeZone:'Africa/Addis_Ababa' as const},
        }:{}),
    };
    const entries:Transaction[]=[tx];
    const commands: SqlCommand[] = [transactionInsert(tx)];
    if (fees > 0 && candidate.type === 'DEBIT') {
        const fee:Transaction={ ...tx, id: `${tx.id}-fee`, amount: fees / 100, amountMinor: fees, subType: 'FEE',isTransfer:false,transferWalletId:undefined,
            note: feeDescription(candidate) || `Fees: ${candidate.description}`, feeAmount: undefined, vatAmount: undefined,
            currentBalance: undefined, smsReference: undefined, smsFingerprint: undefined };
        entries.push(fee);commands.push(transactionInsert(fee));
    }
    // The established CBE transfer template explicitly identifies both accounts. With
    // reviewed ownership of that exact destination, record both legs from that evidence.
    // Generic debits never invent a destination credit.
    if(candidate.providerId==='cbe' && review?.treatment==='transfer' && candidate.type==='DEBIT' && candidate.destinationAccountLast4 && peer) {
        const income=context.categories.find(c=>c.flow==='INCOME');
        if(!income)return result('review','An income-flow category is required for the destination transfer leg',candidate);
        const incoming:Transaction={...tx,id:`${tx.id}-to`,type:'CREDIT',walletId:peer.id,categoryId:income.id,transferWalletId:wallet.id,currentBalance:undefined,feeAmount:undefined,vatAmount:undefined,smsFingerprint:undefined,
            smsDetails:{...tx.smsDetails!,walletId:peer.id,accountLast4:peer.accountNumberLast4!,direction:'CREDIT',feeMinor:0,ledgerMinor:principal,chargesMinor:{serviceCharge:0,vat:0,disasterFund:0,otherFees:0}}};
        entries.push(incoming);commands.push(transactionInsert(incoming));
        commands.push({sql:'INSERT INTO transfers(id,from_transaction_id,to_transaction_id,from_wallet_id,to_wallet_id,amount,fee_amount,fee_transaction_id,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?);',params:[`tr-${tx.id}`,tx.id,incoming.id,wallet.id,peer.id,principal/100,fees/100,fees ? `${tx.id}-fee`:null,'Reviewed explicit CBE source and destination accounts',tx.createdAt]});
    }
    commands.push({
        sql: 'UPDATE wallets SET balance = (ROUND(balance * 100) + ?) / 100.0 WHERE id = ?;',
        params: [candidate.type === 'DEBIT' ? -ledger : ledger, wallet.id],
    });
    commands.push({ sql: 'INSERT INTO sms_import_receipts(message_key, transaction_id, created_at) VALUES (?, ?, ?);',
        params: [message.id, tx.id, tx.createdAt] });
    return { status: 'imported', balanceCheckpoint, reason: time.dateSource === 'sms_received' ? 'Imported using the original SMS received time (no event date supplied)' : 'Imported using the transaction event date', candidate, transaction: tx, commands,
        compatibleFingerprints:candidate.providerId==='cbe' ? cbeCompatibleFingerprints(candidate):undefined,
        entries:candidate.providerId==='cbe' ? entries:undefined,
        normalized: { provider: candidate.providerId, senderId: message.sender, destinationAccount: wallet.id,
            reference: candidate.reference, amountMinor: principal, ledgerAmountMinor: ledger, feeMinor: fees,
            currency: candidate.currency, direction: candidate.type === 'DEBIT' ? 'debit' : 'credit',
            type: tx.subType ?? 'STANDARD', counterparty: candidate.counterparty, occurredAt: time.occurredAt,
            receivedAt: time.receivedAt, importedAt: tx.importedAt!, dateSource:time.dateSource, datePrecision:time.datePrecision, eventDate:time.eventDate, confidence: 'validated',
            missingFields: [...(!candidate.reference ? ['reference'] : []), ...(time.dateSource === 'sms_received' ? ['explicit event date'] : [])],
            ...(candidate.providerId==='cbe' ? {accountLast4:candidate.accountLast4,chargesMinor,sourceEvidence,reviewReasons:tx.smsDetails!.reviewReasons}:{}), } };
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
    const fingerprints=plan.compatibleFingerprints ?? [tx.smsFingerprint!];
    return { sql: `SELECT id FROM transactions WHERE id = ? OR sms_fingerprint IN (${fingerprints.map(()=>'?').join(',')})
        OR (sms_reference = ? COLLATE NOCASE AND wallet_id = ? AND type = ?) LIMIT 1;`,
        params: [tx.id, ...fingerprints, tx.smsReference ?? null, tx.walletId, tx.type] };
}
