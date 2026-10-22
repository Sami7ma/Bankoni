// sms/providers/cbe.ts
// Parser implementation for Commercial Bank of Ethiopia (CBE) SMS messages.
// Pure TypeScript domain logic.

import {
    normalizeSmsText,
    parseSantim,
    santimToEtb,
    formatSantim,
    extractAccountLast4,
    parseEthiopianDateTime,
} from '../cleaners';
import type { ParsedTransactionCandidate, SmsParseResult, FeeBreakdown } from '../types';

/**
 * Extracts reference from CBE receipt or branch receipt URLs if present.
 * Examples:
 *   "https://apps.cbe.com.et:100/?id=FT2412345678" -> "FT2412345678"
 *   "https://apps.cbe.com.et/Receipt/CBE12345"     -> "CBE12345"
 *   "https://cbe.et/r/FT98765"                     -> "FT98765"
 */
function extractCbeReference(text: string): string | undefined {
    // 1. Direct query param ?id=, &id=, or id= in text (e.g. "id=FT26107777")
    const idParamMatch = text.match(/(?:[?&]id=|\bid\s*=\s*)([A-Za-z0-9]+)/i);
    if (idParamMatch) return idParamMatch[1];

    // 2. Explicit txn/ref labels
    const refLabelMatch = text.match(/\b(?:txn\s*(?:id|no)?|ref(?:\s*no)?|reference)\s*[:=\s]\s*([A-Za-z0-9]+)\b/i);
    if (refLabelMatch) return refLabelMatch[1];

    // 3. Receipt path pattern /Receipt/<ref> or /BranchReceipt/<ref>
    const receiptPathMatch = text.match(/\/(?:Receipt|BranchReceipt)\/([A-Za-z0-9]+)/i);
    if (receiptPathMatch) return receiptPathMatch[1];

    // 4. URL ending with alphanumeric token starting with FT or CBE
    const ftUrlMatch = text.match(/https?:\/\/[^\s/]+\/[^\s]*\b(FT[A-Za-z0-9]+)\b/i);
    if (ftUrlMatch) return ftUrlMatch[1];

    // 5. Standalone FT transaction ID (e.g., FT2412345678)
    const standaloneFt = text.match(/\b(FT[0-9A-Z]{6,})\b/i);
    if (standaloneFt) return standaloneFt[1];

    return undefined;
}

/**
 * Helper to extract fees and validate arithmetic from CBE fee strings.
 */
function extractCbeFees(
    text: string,
    principalSantim: number
): {
    feeBreakdown?: FeeBreakdown;
    ledgerSantim: number;
    isDerived: boolean;
    error?: string;
} {
    const scMatch = text.match(/(?:Service\s+charge|S\.charge|service\s+charge|s\.charge)\s+of\s+ETB\s*([\d,.]+)/i);
    const vatMatch = text.match(/(?:and\s+)?VAT(?:\(15%\))?\s+of\s+(?:ETB\s*)?([\d,.]+)/i);
    const disasterMatch = text.match(/(?:and\s+)?(?:Disaster\s+Recovery|Disaster\s+Fund)(?:\(5%\))?\s+of\s+(?:ETB\s*)?([\d,.]+)/i);
    const totalMatch = text.match(/(?:with\s+)?(?:a\s+)?total\s+of\s+ETB\s*([\d,.]+)/i);

    const scSantim = scMatch ? parseSantim(scMatch[1]) ?? 0 : 0;
    const vatSantim = vatMatch ? parseSantim(vatMatch[1]) ?? 0 : 0;
    const disasterSantim = disasterMatch ? parseSantim(disasterMatch[1]) ?? 0 : 0;
    const statedTotalSantim = totalMatch ? parseSantim(totalMatch[1]) : null;

    const totalFeesSantim = scSantim + vatSantim + disasterSantim;
    const hasAnyFees = totalFeesSantim > 0;

    let feeBreakdown: FeeBreakdown | undefined = undefined;
    if (hasAnyFees) {
        feeBreakdown = {
            serviceCharge: scSantim > 0 ? santimToEtb(scSantim) : undefined,
            vat: vatSantim > 0 ? santimToEtb(vatSantim) : undefined,
            disasterFund: disasterSantim > 0 ? santimToEtb(disasterSantim) : undefined,
            totalFees: santimToEtb(totalFeesSantim),
        };
    }

    const calculatedTotalSantim = principalSantim + totalFeesSantim;

    if (statedTotalSantim != null) {
        // Verify arithmetic with a 1-santim tolerance for fractional cent rounding
        if (Math.abs(calculatedTotalSantim - statedTotalSantim) > 1) {
            return {
                ledgerSantim: statedTotalSantim,
                isDerived: false,
                error: `CBE fee arithmetic mismatch: Principal (${formatSantim(principalSantim)}) + Fees (${formatSantim(totalFeesSantim)}) does not match stated total (${formatSantim(statedTotalSantim)}).`,
            };
        }
        return {
            feeBreakdown,
            ledgerSantim: statedTotalSantim,
            isDerived: false,
        };
    }

    if (hasAnyFees) {
        return {
            feeBreakdown,
            ledgerSantim: calculatedTotalSantim,
            isDerived: true,
        };
    }

    return {
        feeBreakdown,
        ledgerSantim: principalSantim,
        isDerived: false,
    };
}

/**
 * Parses CBE SMS messages.
 */
export function parseCbeSms(rawText: string): SmsParseResult {
    const text = normalizeSmsText(rawText);
    const warnings: string[] = [];

    // --- PATTERN 1: CBE Debit Transaction with Fees ---
    // Example: "Dear Customer, A debit transaction of ETB 1300.0 has occurred on your account 1000****1234. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB1312.00. Your current balance is ETB840,060.64. Thanks for Banking with CBE."
    const debitMatch = text.match(
        /A\s+debit\s+transaction\s+of\s+ETB\s*([^\s]+)\s*(?:has\s+occurred\s+on|occurred\s+on)?\s+your\s+account\s+([^\s.]+)/i
    );
    if (debitMatch) {
        const principalSantim = parseSantim(debitMatch[1]);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing CBE debit amount.' };
        }

        const account = debitMatch[2].replace(/[.,]$/, '');
        const balanceMatch = text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;

        const feeResult = extractCbeFees(text, principalSantim);
        if (feeResult.error) {
            return { status: 'ambiguous', reason: feeResult.error };
        }

        const reference = extractCbeReference(text);
        const dateMatch = text.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?))?/i);
        let dateTime: string | undefined = undefined;
        if (dateMatch) {
            dateTime = parseEthiopianDateTime(dateMatch[1] + (dateMatch[2] ? ` ${dateMatch[2]}` : '')) ?? undefined;
        }

        if (!dateTime) {
            warnings.push('Transaction date was not specified in the message. Please review and confirm the date.');
        }

        const candidate: ParsedTransactionCandidate = {
            providerId: 'cbe',
            type: 'DEBIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(feeResult.ledgerSantim),
            isLedgerAmountDerived: feeResult.isDerived,
            fees: feeResult.feeBreakdown,
            currency: 'ETB',
            accountIdentifier: account,
            accountLast4: extractAccountLast4(account),
            reference,
            dateTime,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: 'CBE Debit Transaction',
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // --- PATTERN 2: CBE Successful Transfer with Fees ---
    // Example: "Dear Customer, You have successfully transferred ETB300.00 from account 1000****1234 to account 1000****5678 (ABEBE BIKILA). Service charge of ETB 0.50 and VAT(15%) of ETB0.08 and Disaster Recovery(5%) of 0.03 with total of ETB300.61. Your current balance is ETB5,000.00."
    const transferMatch = text.match(
        /You\s+have\s+(?:successfully\s+)?transferred\s+ETB\s*([^\s]+)\s+from\s+account\s+([^\s]+)\s+to\s+account\s+([^\s(]+)(?:\s*\(([^)]+)\))?/i
    );
    if (transferMatch) {
        const principalSantim = parseSantim(transferMatch[1]);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing CBE transfer amount.' };
        }

        const sourceAccount = transferMatch[2].replace(/[.,]$/, '');
        const destAccount = transferMatch[3].replace(/[.,]$/, '');
        const recipient = transferMatch[4]?.trim();

        const balanceMatch = text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;

        const feeResult = extractCbeFees(text, principalSantim);
        if (feeResult.error) {
            return { status: 'ambiguous', reason: feeResult.error };
        }

        const reference = extractCbeReference(text);
        const dateMatch = text.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?))?/i);
        let dateTime: string | undefined = undefined;
        if (dateMatch) {
            dateTime = parseEthiopianDateTime(dateMatch[1] + (dateMatch[2] ? ` ${dateMatch[2]}` : '')) ?? undefined;
        }

        if (!dateTime) {
            warnings.push('Transaction date was not specified in the message. Please review and confirm the date.');
        }

        const counterpartyDesc = recipient
            ? `${recipient} (Acct ${destAccount})`
            : `Account ${destAccount}`;

        const candidate: ParsedTransactionCandidate = {
            providerId: 'cbe',
            type: 'DEBIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(feeResult.ledgerSantim),
            isLedgerAmountDerived: feeResult.isDerived,
            fees: feeResult.feeBreakdown,
            currency: 'ETB',
            accountIdentifier: sourceAccount,
            accountLast4: extractAccountLast4(sourceAccount),
            counterparty: counterpartyDesc,
            reference,
            dateTime,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: `Transfer to ${counterpartyDesc}`,
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // --- PATTERN 3: CBE Credit / Deposit ---
    // Example: "Account 1000****1234 has been credited with ETB 2,500.00. Balance is ETB 10,000.00. id=FT26101234"
    const creditMatch = text.match(
        /(?:Account|Acct|your\s+account)\s+([^\s]+)\s+(?:has\s+been|is)\s+credited\s+(?:with\s+)?ETB\s*([^\s]+)/i
    ) || text.match(
        /You\s+have\s+received\s+ETB\s*([^\s]+)\s+(?:from\s+(.+?)\s+)?(?:in|into|to)\s+(?:your\s+)?account\s+([^\s.]+)/i
    );

    if (creditMatch) {
        let account: string;
        let rawAmount: string;
        let counterparty: string | undefined;

        if (creditMatch[0].toLowerCase().includes('received')) {
            rawAmount = creditMatch[1];
            counterparty = creditMatch[2]?.trim();
            account = creditMatch[3];
        } else {
            account = creditMatch[1];
            rawAmount = creditMatch[2];
        }

        account = account.replace(/[.,]$/, '');
        const principalSantim = parseSantim(rawAmount);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing CBE credit amount.' };
        }

        const balanceMatch = text.match(/(?:current\s+balance|balance)\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;
        const reference = extractCbeReference(text);

        const dateMatch = text.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?))?/i);
        let dateTime: string | undefined = undefined;
        if (dateMatch) {
            dateTime = parseEthiopianDateTime(dateMatch[1] + (dateMatch[2] ? ` ${dateMatch[2]}` : '')) ?? undefined;
        }

        if (!dateTime) {
            warnings.push('Transaction date was not specified in the message. Please review and confirm the date.');
        }

        const candidate: ParsedTransactionCandidate = {
            providerId: 'cbe',
            type: 'CREDIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            accountIdentifier: account,
            accountLast4: extractAccountLast4(account),
            counterparty,
            reference,
            dateTime,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: counterparty ? `CBE Credit from ${counterparty}` : 'CBE Credit Deposit',
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    return {
        status: 'ambiguous',
        reason: 'Message matches Commercial Bank of Ethiopia (CBE), but could not find a recognized transaction debit, credit, or transfer structure.',
    };
}
