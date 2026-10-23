// sms/providers/awash.ts
// Parser implementation for Awash Bank SMS messages.
// Pure TypeScript domain logic.

import {
    normalizeSmsText,
    parseSantim,
    santimToEtb,
    extractAccountLast4,
    parseEthiopianDateTime,
} from '../cleaners';
import type { ParsedTransactionCandidate, SmsParseResult } from '../types';

/**
 * Parses Awash Bank SMS messages.
 * Currently supports the verified incoming-credit format.
 * Ignores complaint/enquiry numbers, Telegram channels, and feedback survey links.
 */
export function parseAwashSms(rawText: string): SmsParseResult {
    const text = normalizeSmsText(rawText);
    const warnings: string[] = [];

    // --- PATTERN 1: Incoming Credit ---
    // Example: "Dear Customer, your Account 1000****1234 has been Credited with ETB 2000.00 on 2026-10-14 08:32:28 by JOHN DOE via IPS DASHEN BANK. Your balance now is ETB 34720.30. For any complaint or enquiry, please call 8980. Subscribe to our official Telegram channel: https://t.me/... for more information. Please give us your feedback using the following link: https://... Awash Bank."
    const creditMatch = text.match(
        /your\s+Account\s+([^\s]+)\s+has\s+been\s+Credited\s+with\s+ETB\s*([\d,.]+)(?:\s+on\s+(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}))?(?:\s+by\s+([^.]+?))?(?:\.|$)/i
    );

    if (creditMatch) {
        const rawAccount = creditMatch[1].replace(/[.,]$/, '').trim();
        const rawAmount = creditMatch[2];
        const rawDate = creditMatch[3]?.trim();
        const counterparty = creditMatch[4]?.trim();

        const principalSantim = parseSantim(rawAmount);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing Awash credit amount.' };
        }

        const dateTime = rawDate ? parseEthiopianDateTime(rawDate) : null;
        if (!dateTime) {
            warnings.push('Transaction date was not provided in the SMS. Please confirm the date before importing.');
        }

        // Current balance extraction
        const balanceMatch = text.match(/balance\s+now\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;
        const currentBalance = balanceSantim != null ? santimToEtb(balanceSantim) : undefined;

        // Awash credit SMS in this format does not provide a transaction reference.
        // We explicitly do NOT treat Telegram, feedback, or survey URLs as references.
        warnings.push('No transaction reference was provided in the Awash message. Deduplication relies on account, timestamp, and amount.');

        const accountLast4 = extractAccountLast4(rawAccount);
        const description = counterparty
            ? `Awash Bank credit from ${counterparty}`
            : 'Awash Bank credit';

        const candidate: ParsedTransactionCandidate = {
            providerId: 'awash',
            type: 'CREDIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            accountIdentifier: rawAccount,
            accountLast4,
            counterparty,
            reference: undefined,
            dateTime: dateTime || undefined,
            currentBalance,
            description,
            rawSms: text,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // Explicit rejection for unverified debit formats rather than guessing
    if (/debited\s+with/i.test(text)) {
        return {
            status: 'malformed',
            reason: 'Awash Bank debit messages are not yet officially supported in this version. Please enter this transaction manually.',
        };
    }

    return {
        status: 'malformed',
        reason: 'Unrecognized Awash Bank message format. Supported format is incoming credit notification.',
    };
}
