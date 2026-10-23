// sms/providers/mpesa.ts
// Parser implementation for M-PESA Ethiopia (Safaricom) SMS messages.
// Pure TypeScript domain logic.

import {
    normalizeSmsText,
    parseSantim,
    santimToEtb,
    parseEthiopianDateTime,
    detectDirectionFromKeywords,
    extractAccountLast4,
} from '../cleaners';
import type { ParsedTransactionCandidate, SmsParseResult } from '../types';

/**
 * Extracts transaction reference from M-PESA SMS text.
 * Handles "Transaction number is XXXXX" or "Transaction number XXXXX".
 * Prefers the explicit transaction number in the message text over URL references.
 */
function extractMpesaReference(text: string): string | undefined {
    const refMatch = text.match(/\bTransaction\s+number\s+(?:is\s+)?([A-Za-z0-9_-]+)\b/i);
    if (refMatch) return refMatch[1].replace(/[.,]$/, '');
    return undefined;
}

/**
 * Extracts current M-PESA balance if present in the message.
 * Example: "Your current M-PESA balance is 442.00 Birr."
 */
function extractMpesaBalance(text: string): number | undefined {
    const balanceMatch = text.match(/current\s+M-PESA\s+balance\s+is\s+([\d,.]+)\s*(?:Birr|ETB)?/i);
    if (balanceMatch) {
        const santim = parseSantim(balanceMatch[1]);
        return santim != null ? santimToEtb(santim) : undefined;
    }
    return undefined;
}

/**
 * Parses M-PESA Ethiopia SMS messages.
 * Supports:
 *   1. Safaricom bundle purchase -> DEBIT (Internet / Data Package)
 *   2. Incoming transfer (CBE-B2C or P2P) -> CREDIT
 *   3. Outgoing Merchant Payment / Buy Goods -> DEBIT
 *   4. Outgoing P2P Transfer / Send Money -> DEBIT
 *   5. M-PESA cashback notification -> CREDIT
 *   6. Resilient Fallback Parser -> detects direction (debited vs credited), amount, reference, and balance
 */
export function parseMpesaSms(rawText: string): SmsParseResult {
    const text = normalizeSmsText(rawText);
    const warnings: string[] = [];

    // --- PATTERN 1: Safaricom Bundle Purchase (DEBIT) ---
    // Example: "Dear [CUSTOMER], you have bought a Safaricom bundle of 160.00 Birr for 0712345678 on 21/10/26 at 12:37 PM. Transaction number RA12345678. Your current M-PESA balance is 282.00 Birr. Get your receipt here: https://..."
    const bundleMatch = text.match(
        /you\s+have\s+bought\s+a\s+Safaricom\s+bundle\s+of\s+([\d,.]+)\s*(?:Birr|ETB)(?:\s+for\s+([^\s]+))?\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4}\s+at\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))/i
    );
    if (bundleMatch) {
        const rawAmount = bundleMatch[1];
        const beneficiaryPhone = bundleMatch[2]?.replace(/[.,]$/, '');
        const rawDate = bundleMatch[3].trim();

        const principalSantim = parseSantim(rawAmount);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing M-PESA bundle amount.' };
        }

        const dateTime = parseEthiopianDateTime(rawDate);
        if (!dateTime) {
            warnings.push('Could not parse transaction timestamp. Please confirm the date.');
        }

        const reference = extractMpesaReference(text);
        const currentBalance = extractMpesaBalance(text);
        const description = beneficiaryPhone
            ? `Safaricom bundle purchase for ${beneficiaryPhone}`
            : 'Safaricom bundle purchase';

        const candidate: ParsedTransactionCandidate = {
            providerId: 'mpesa',
            type: 'DEBIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            counterparty: beneficiaryPhone ? `Safaricom (${beneficiaryPhone})` : 'Safaricom',
            reference,
            dateTime: dateTime || undefined,
            currentBalance,
            description,
            rawSms: text,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // --- PATTERN 2: Incoming Transfer (CREDIT) ---
    // Example: "Dear [CUSTOMER], you have received 300.00 Birr from Commercial Bank Of Ethiopia-B2C - [COUNTERPARTY] on 21/10/26 at 12:37 PM. Transaction number is FT12345678. Your current M-PESA balance is 442.00 Birr. Use the below link to harmonize your M-PESA account with Fayda: https://..."
    const incomingMatch = text.match(
        /(?:you\s+have\s+received|credited\s+with)\s+([\d,.]+)\s*(?:Birr|ETB)\s+from\s+([^\n]+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4}\s+at\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))/i
    );
    if (incomingMatch) {
        const rawAmount = incomingMatch[1];
        const rawCounterparty = incomingMatch[2].trim();
        const rawDate = incomingMatch[3].trim();

        const principalSantim = parseSantim(rawAmount);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing M-PESA received amount.' };
        }

        const dateTime = parseEthiopianDateTime(rawDate);
        if (!dateTime) {
            warnings.push('Could not parse transaction timestamp. Please confirm the date.');
        }

        const reference = extractMpesaReference(text);
        const currentBalance = extractMpesaBalance(text);

        const candidate: ParsedTransactionCandidate = {
            providerId: 'mpesa',
            type: 'CREDIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            counterparty: rawCounterparty,
            reference,
            dateTime: dateTime || undefined,
            currentBalance,
            description: `M-PESA transfer from ${rawCounterparty}`,
            rawSms: text,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // --- PATTERN 3: Outgoing Merchant Payment / Buy Goods / Paybill (DEBIT) ---
    // Example: "Dear Customer, you have paid 250.00 Birr to Tomoca Coffee on 21/10/26 at 10:15 AM. Transaction number RA55443322. Your current M-PESA balance is 750.00 Birr."
    const merchantMatch = text.match(
        /(?:you\s+have\s+paid|debited\s+with)\s+([\d,.]+)\s*(?:Birr|ETB)\s+(?:for\s+payment\s+)?to\s+([^\n]+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4}\s+at\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))/i
    );
    if (merchantMatch) {
        const rawAmount = merchantMatch[1];
        const rawCounterparty = merchantMatch[2].trim();
        const rawDate = merchantMatch[3].trim();

        const principalSantim = parseSantim(rawAmount);
        if (principalSantim && principalSantim > 0) {
            const dateTime = parseEthiopianDateTime(rawDate);
            const reference = extractMpesaReference(text);
            const currentBalance = extractMpesaBalance(text);

            const isPackage = /package|bundle|internet/i.test(rawCounterparty);

            const candidate: ParsedTransactionCandidate = {
                providerId: 'mpesa',
                type: 'DEBIT',
                principalAmount: santimToEtb(principalSantim),
                ledgerAmount: santimToEtb(principalSantim),
                isLedgerAmountDerived: false,
                currency: 'ETB',
                counterparty: rawCounterparty,
                reference,
                dateTime: dateTime || undefined,
                currentBalance,
                description: isPackage ? `Internet Package: ${rawCounterparty}` : `Payment to ${rawCounterparty}`,
                rawSms: text,
                warnings,
            };

            return { status: 'parsed', candidate };
        }
    }

    // --- PATTERN 4: Outgoing P2P Transfer / Send Money (DEBIT) ---
    // Example: "Dear Customer, you have sent 500.00 Birr to 0712345678 (Abebe Bikila) on 21/10/26 at 02:45 PM. Transaction number RA99887766. Your current M-PESA balance is 250.00 Birr."
    const p2pMatch = text.match(
        /(?:you\s+have\s+sent|you\s+have\s+transferred)\s+([\d,.]+)\s*(?:Birr|ETB)\s+to\s+([^\n]+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4}\s+at\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))/i
    );
    if (p2pMatch) {
        const rawAmount = p2pMatch[1];
        const rawCounterparty = p2pMatch[2].trim();
        const rawDate = p2pMatch[3].trim();

        const principalSantim = parseSantim(rawAmount);
        if (principalSantim && principalSantim > 0) {
            const dateTime = parseEthiopianDateTime(rawDate);
            const reference = extractMpesaReference(text);
            const currentBalance = extractMpesaBalance(text);

            const candidate: ParsedTransactionCandidate = {
                providerId: 'mpesa',
                type: 'DEBIT',
                principalAmount: santimToEtb(principalSantim),
                ledgerAmount: santimToEtb(principalSantim),
                isLedgerAmountDerived: false,
                currency: 'ETB',
                counterparty: rawCounterparty,
                reference,
                dateTime: dateTime || undefined,
                currentBalance,
                description: `M-PESA transfer to ${rawCounterparty}`,
                rawSms: text,
                warnings,
            };

            return { status: 'parsed', candidate };
        }
    }

    // --- PATTERN 5: M-PESA Cashback (CREDIT) ---
    // Example: "Congratulations, you have received a cashback of 0.60 Birr for Paying via M-PESA."
    const cashbackMatch = text.match(
        /received\s+a\s+cashback\s+of\s+([\d,.]+)\s*(?:Birr|ETB)\s+for\s+Paying\s+via\s+M-PESA/i
    );
    if (cashbackMatch) {
        const rawAmount = cashbackMatch[1];
        const principalSantim = parseSantim(rawAmount);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing M-PESA cashback amount.' };
        }

        warnings.push('Transaction date was not provided in the SMS. Please confirm the date before importing.');
        warnings.push('No transaction reference was found in the message. Duplicate detection relies on confirmed date and amount.');

        const candidate: ParsedTransactionCandidate = {
            providerId: 'mpesa',
            type: 'CREDIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            counterparty: 'M-PESA Cashback',
            reference: undefined,
            dateTime: undefined,
            currentBalance: undefined,
            description: 'M-PESA cashback',
            rawSms: text,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // --- RESILIENT UNIVERSAL FALLBACK FOR M-PESA ---
    // Automatically extracts direction (debited vs credited), reference, balance, timestamp, and amount
    const reference = extractMpesaReference(text);
    const currentBalance = extractMpesaBalance(text);
    const direction = detectDirectionFromKeywords(text, 'DEBIT');

    const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4}\s+at\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))/i);
    const dateTime = dateMatch ? parseEthiopianDateTime(dateMatch[1]) : undefined;

    // Amount extraction (excluding current balance)
    let principalSantim: number | null = null;
    const amountRegex = /(?:Birr|ETB)\s*([\d,.]+)|([\d,.]+)\s*(?:Birr|ETB)/gi;
    let amtMatch: RegExpExecArray | null;
    const balanceSantim = currentBalance != null ? Math.round(currentBalance * 100) : null;

    while ((amtMatch = amountRegex.exec(text)) !== null) {
        const amtStr = amtMatch[1] || amtMatch[2];
        const parsed = parseSantim(amtStr);
        if (parsed != null && parsed > 0 && parsed !== balanceSantim) {
            principalSantim = parsed;
            break;
        }
    }

    if (reference && dateTime && principalSantim != null && principalSantim > 0) {
        const isPackage = /bundle|package|internet|data/i.test(text);
        const description = isPackage
            ? 'Safaricom bundle purchase'
            : (direction.type === 'CREDIT' ? 'M-PESA Received' : 'M-PESA Payment');

        const candidate: ParsedTransactionCandidate = {
            providerId: 'mpesa',
            type: direction.type,
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            counterparty: 'M-PESA',
            reference,
            dateTime: dateTime || undefined,
            currentBalance,
            description,
            rawSms: text,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    return {
        status: 'malformed',
        reason: 'Unrecognized M-PESA message format. Supported formats are Incoming Transfer, Safaricom Bundle Purchase, Merchant Payment, and Cashback notifications.',
    };
}
