// sms/providers/boa.ts
// Parser implementation for Bank of Abyssinia (BOA) SMS messages.
// Pure TypeScript domain logic.

import {
    normalizeSmsText,
    parseSantim,
    santimToEtb,
    extractAccountLast4,
} from '../cleaners';
import type { ParsedTransactionCandidate, SmsParseResult } from '../types';

/**
 * Extracts transaction reference strictly from the BOA receipt slip URL (/slip/?trx=...).
 * Excludes feedback URLs (/cs/?trx=...) and other unrelated links (Fayda, etc.).
 */
export function extractBoaReceiptReference(text: string): string | undefined {
    // Specifically target the /slip/?trx= parameter
    const slipMatch = text.match(/\/slip\/(?:\?[^#\s]*\btrx=|\?trx=)([A-Za-z0-9_-]+)/i);
    if (slipMatch) return slipMatch[1].replace(/[.,]$/, '');

    // Target Receipt: https://...trx=...
    const receiptLabelMatch = text.match(/Receipt\s*:\s*https?:\/\/[^\s]*?[?&]trx=([A-Za-z0-9_-]+)/i);
    if (receiptLabelMatch) return receiptLabelMatch[1].replace(/[.,]$/, '');

    return undefined;
}

/**
 * Extracts available balance from BOA messages.
 * Example: "Available Balance: ETB 10,862.76."
 */
function extractBoaBalance(text: string): number | undefined {
    const match = text.match(/Available\s+Balance\s*:\s*ETB\s*([\d,.]+)/i);
    if (match) {
        const santim = parseSantim(match[1]);
        return santim != null ? santimToEtb(santim) : undefined;
    }
    return undefined;
}

/**
 * Parses Bank of Abyssinia (BOA) SMS messages.
 * Supports:
 *   1. Verified Debit format
 *   2. Provisional Incoming Credit format (reconstructed from partial screenshot)
 */
export function parseBoaSms(rawText: string): SmsParseResult {
    const text = normalizeSmsText(rawText);
    const warnings: string[] = [];

    // --- PATTERN 1: Verified Debit Format ---
    // Example: "Dear [CUSTOMER], your account 1000****5678 was debited with ETB 1,006.00. Available Balance: ETB 10,862.76. Receipt: https://cs.bankofabyssinia.com/slip/?trx=FT2610ABCDEF Feedback: https://cs.bankofabyssinia.com/cs/?trx=DFT12345678 Link your Fayda: https://... For help, call 8397 (24/7 Toll-Free). Bank of Abyssinia."
    const debitMatch = text.match(
        /your\s+account\s+([^\s]+)\s+was\s+debited\s+with\s+ETB\s*([\d,.]+)/i
    );

    if (debitMatch) {
        const rawAccount = debitMatch[1].replace(/[.,]$/, '').trim();
        const rawAmount = debitMatch[2];

        const principalSantim = parseSantim(rawAmount);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing BOA debit amount.' };
        }

        // Strictly extract reference from /slip/?trx= and NOT /cs/?trx=
        const reference = extractBoaReceiptReference(text);
        const currentBalance = extractBoaBalance(text);

        // Date is not provided in the SMS body for this format
        warnings.push('Transaction date was not provided in the SMS. Please confirm the date before importing.');

        const accountLast4 = extractAccountLast4(rawAccount);

        const candidate: ParsedTransactionCandidate = {
            providerId: 'boa',
            type: 'DEBIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            accountIdentifier: rawAccount,
            accountLast4,
            reference,
            dateTime: undefined,
            currentBalance,
            description: 'Bank of Abyssinia debit',
            rawSms: text,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // --- PATTERN 2: Provisional Incoming Credit (Reconstructed from Partial Sample) ---
    // Note: Isolate this pattern as provisional until full production SMS is confirmed.
    const provisionalCreditMatch = text.match(
        /your\s+account\s+([^\s]+)\s+(?:has\s+been|was)\s+credited\s+with\s+ETB\s*([\d,.]+)(?:\s+from\s+([^.]+?))?(?:\.|$)/i
    );

    if (provisionalCreditMatch) {
        const rawAccount = provisionalCreditMatch[1].replace(/[.,]$/, '').trim();
        const rawAmount = provisionalCreditMatch[2];
        const counterparty = provisionalCreditMatch[3]?.trim();

        const principalSantim = parseSantim(rawAmount);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing BOA credit amount.' };
        }

        const reference = extractBoaReceiptReference(text);
        const currentBalance = extractBoaBalance(text);

        warnings.push('PROVISIONAL: This BOA credit format was reconstructed from a partial sample and requires user confirmation.');
        warnings.push('Transaction date was not provided in the SMS. Please confirm the date before importing.');

        const accountLast4 = extractAccountLast4(rawAccount);

        const candidate: ParsedTransactionCandidate = {
            providerId: 'boa',
            type: 'CREDIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            accountIdentifier: rawAccount,
            accountLast4,
            counterparty,
            reference,
            dateTime: undefined,
            currentBalance,
            description: counterparty ? `Bank of Abyssinia credit from ${counterparty}` : 'Bank of Abyssinia credit',
            rawSms: text,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    return {
        status: 'malformed',
        reason: 'Unrecognized Bank of Abyssinia message format. Supported format is account debit notification.',
    };
}
