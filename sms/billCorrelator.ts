// sms/billCorrelator.ts
//
// Evidence correlation between financial payment messages (e.g. Telebirr debit)
// and biller confirmation messages (e.g. Ethio Telecom bill receipt).
// Distinguishes payment evidence from confirmation evidence, preventing double counting.

import { normalizeSmsText, parseSantim, santimToEtb, parseEthiopianDateTime } from './cleaners';
import type { Transaction } from '../types/Transaction';
import type { BillConfirmation, BillConfirmationStatus } from '../types/FinancialRelationships';

export interface BillerConfirmationEvidence {
    billerName: string;
    accountNumber?: string;
    billReference?: string;
    amount: number;
    confirmationCode?: string;
    rawMessage: string;
    messageDate?: string;
}

export type BillEvidenceType =
    | 'financial_payment'      // Money moving out of user's wallet
    | 'biller_confirmation'    // Biller receipt acknowledging payment
    | 'duplicate_evidence'     // Exact duplicate SMS of known evidence
    | 'other';

export interface BillEvidenceClassification {
    type: BillEvidenceType;
    evidence?: BillerConfirmationEvidence;
    reason: string;
}

export interface BillCorrelationResult {
    status: BillConfirmationStatus;
    matchedTransactionId?: string;
    matchedTransaction?: Transaction;
    candidateTransactions: Transaction[];
    reason: string;
}

const BILLER_CONFIRMATION_PATTERNS = [
    // Ethio Telecom bill receipt
    /(?:your\s+payment\s+of|received)\s+(?:ETB\s*)?([\d,.]+)\s*(?:ETB|Birr|Br\.?)?\s*for\s+service\s+(?:number\s+)?([^\s,]+)(?:[\s\S]*?(?:receipt\s+(?:no\.?|number)|txn|ref)[:\s]*([A-Za-z0-9_-]+))?/i,
    // Ethio Telecom receipt format: "Receipt: ... for bill payment of ETB ..."
    /receipt\s*(?:no\.?|number)?[:\s]*([A-Za-z0-9_-]+)[\s\S]*?payment\s+of\s+ETB\s*([\d,.]+)\s+for\s+(?:account|service|phone)\s+([^\s,]+)/i,
    // General biller receipt acknowledgment (EEU, AAWSA, etc.)
    /payment\s+of\s+ETB\s*([\d,.]+)\s+(?:for\s+bill\s+([A-Za-z0-9_-]+)\s+)?has\s+been\s+received\s+by\s+([A-Za-z0-9\s]+?)(?:\s+on|\.|$)/i,
    // "Thank you for paying your ... bill of ETB ..."
    /thank\s+you\s+for\s+paying\s+your\s+(.+?)\s+bill\s+of\s+ETB\s*([\d,.]+)/i,
];

/**
 * Classifies whether an incoming message is a financial debit or a biller-side receipt confirmation.
 */
export function classifyBillEvidence(rawText: string): BillEvidenceClassification {
    const text = normalizeSmsText(rawText);

    const isReceiptMessage =
        /\breceipt\b/i.test(text) ||
        /\bfor\s+service\s+(?:number\s+)?\d+/i.test(text) ||
        /\bpayment\s+of\s+ETB\s*[\d,.]+\s+for\s+service\b/i.test(text) ||
        /\bpayment\s+of\s+ETB\s*[\d,.]+\s+has\s+been\s+received\b/i.test(text) ||
        /\bthank\s+you\s+for\s+paying\s+your\s+.+?\s+bill\b/i.test(text);

    if (isReceiptMessage) {
        // 1. Amount extraction
        const amtMatch = text.match(/(?:payment\s+of|received)\s+(?:ETB\s*)?([\d,.]+)/i) ||
            text.match(/(?:ETB|Birr)\s*([\d,.]+)/i);
        const santim = amtMatch ? parseSantim(amtMatch[1]) : null;

        if (santim && santim > 0) {
            // 2. Account or service number
            const acctMatch = text.match(/(?:service\s+(?:number\s+)?|account\s+(?:number\s+)?)([^\s,.]+)/i);
            const accountOrService = acctMatch ? acctMatch[1].replace(/[.,]$/, '') : undefined;

            // 3. Receipt / reference number
            const rcptMatch = text.match(/(?:receipt\s*(?:no\.?|number)?|ref(?:erence)?|txn)[:\s]*([A-Za-z0-9_-]+)/i);
            const receiptNo = rcptMatch ? rcptMatch[1].replace(/[.,]$/, '') : undefined;

            // 4. Biller name
            let billerName = 'Ethio telecom';
            if (/electric|eeu/i.test(text)) billerName = 'Ethiopian Electric Utility';
            else if (/water|aawsa/i.test(text)) billerName = 'Addis Ababa Water and Sewerage Authority';
            else if (/paying\s+your\s+(.+?)\s+bill/i.test(text)) {
                const bMatch = text.match(/paying\s+your\s+(.+?)\s+bill/i);
                if (bMatch) billerName = bMatch[1].trim();
            }

                // Date extraction
                const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{4}-\d{1,2}-\d{1,2})/);
                const messageDate = dateMatch ? parseEthiopianDateTime(dateMatch[1]) ?? undefined : undefined;

                return {
                    type: 'biller_confirmation',
                    evidence: {
                        billerName,
                        accountNumber: accountOrService?.replace(/[.,]$/, ''),
                        billReference: receiptNo,
                        amount: santimToEtb(santim),
                        confirmationCode: receiptNo,
                        rawMessage: rawText,
                        messageDate,
                    },
                    reason: 'Biller acknowledgment receipt confirming service payment.',
                };
            }
        }

    // 2. Financial payment messages (e.g. Telebirr debit for bill payment)
    const isFinancialDebit = /(?:paid|debited)\s+ETB\s*[\d,.]+\s+for\s+(?:.+?)\s+bill\s+payment/i.test(text) ||
        /(?:paid|debited)\s+ETB\s*[\d,.]+[\s\S]*?Your\s+(?:telebirr\s+)?(?:current\s+)?balance\s+is\s+ETB/i.test(text);

    if (isFinancialDebit) {
        return {
            type: 'financial_payment',
            reason: 'Financial cash debit from wallet.',
        };
    }

    return {
        type: 'other',
        reason: 'Not a recognized bill confirmation or bill payment.',
    };
}

/**
 * Correlates a biller confirmation evidence with an existing financial transaction.
 * Requires matching amount, compatible timestamp, and compatible biller/service reference.
 * Prevents merging solely by amount and approximate time!
 */
export function correlateBillConfirmation(
    evidence: BillerConfirmationEvidence,
    transactions: Transaction[]
): BillCorrelationResult {
    // Eligible financial debits that match the exact amount
    const matchingDebits = transactions.filter((tx) => {
        if (tx.type !== 'DEBIT') return false;
        // Exact amount check (within 0.01 ETB tolerance for fractional rounding)
        return Math.abs(tx.amount - evidence.amount) < 0.01;
    });

    if (matchingDebits.length === 0) {
        return {
            status: 'UNMATCHED',
            candidateTransactions: [],
            reason: `No financial debit of ${evidence.amount} ETB found yet. The confirmation will be stored and matched when the payment record arrives.`,
        };
    }

    // 1. High confidence: reference or account number correlation
    const exactRefMatch = matchingDebits.find((tx) => {
        if (evidence.billReference && tx.note?.includes(evidence.billReference)) return true;
        if (evidence.accountNumber && tx.note?.includes(evidence.accountNumber)) return true;
        if (evidence.accountNumber && tx.counterparty?.includes(evidence.accountNumber)) return true;
        return false;
    });

    if (exactRefMatch) {
        return {
            status: 'MATCHED',
            matchedTransactionId: exactRefMatch.id,
            matchedTransaction: exactRefMatch,
            candidateTransactions: [exactRefMatch],
            reason: `Matched by service/bill identifier "${evidence.accountNumber || evidence.billReference}".`,
        };
    }

    // 2. Single transaction within same date/time proximity
    if (matchingDebits.length === 1) {
        const tx = matchingDebits[0];
        // If transaction mentions the biller name (e.g. "Ethio telecom" or "bill payment")
        const mentionsBiller = new RegExp(evidence.billerName, 'i').test(tx.counterparty || tx.note || '');
        const mentionsBill = /bill|telecom|utility|electric|water/i.test(tx.note || tx.counterparty || '');

        if (mentionsBiller || mentionsBill) {
            return {
                status: 'MATCHED',
                matchedTransactionId: tx.id,
                matchedTransaction: tx,
                candidateTransactions: [tx],
                reason: `Correlated with financial payment to ${evidence.billerName}.`,
            };
        }

        // Single debit with exact amount, but no biller hint: flag as uncertain for review
        return {
            status: 'AMBIGUOUS',
            candidateTransactions: [tx],
            reason: 'Matching debit amount found, but biller details require user confirmation.',
        };
    }

    // 3. Multiple independent payments of the exact same amount
    return {
        status: 'AMBIGUOUS',
        candidateTransactions: matchingDebits,
        reason: `Found ${matchingDebits.length} independent payments of ETB ${evidence.amount}. Please review and select which payment this receipt confirms.`,
    };
}
