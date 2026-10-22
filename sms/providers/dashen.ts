// sms/providers/dashen.ts
// Parser implementation for Dashen Bank SMS messages.
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
 * Extracts optional transaction reference from Dashen SMS messages.
 */
function extractDashenReference(text: string): string | undefined {
    const refMatch = text.match(/\b(?:txn\s*(?:id|no)?|ref(?:\s*no)?|transaction\s*(?:id|number))\s*[:\s]\s*([A-Za-z0-9]+)\b/i);
    if (refMatch) return refMatch[1];
    return undefined;
}

/**
 * Parses Dashen Bank SMS messages.
 */
export function parseDashenSms(rawText: string): SmsParseResult {
    const text = normalizeSmsText(rawText);
    const warnings: string[] = [];

    // --- PATTERN 1: Dashen Credit Transaction ---
    // Example: "Dear Customer, your account '1234****5678' is credited with ETB 230.00 from ABEBE BIKILA on 19/10/2026 at 12:22:25 PM. Your current balance is ETB 4,772.38. Dashen Bank - Always one step ahead!"
    const creditMatch = text.match(
        /your\s+account\s+['"]?([^'"]+?)['"]?\s+is\s+credited\s+with\s+ETB\s*([^\s]+)(?:\s+from\s+([^.]+?))?\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+at\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM))/i
    );
    if (creditMatch) {
        const rawAccount = creditMatch[1].trim();
        const rawAmount = creditMatch[2];
        const counterparty = creditMatch[3]?.trim();
        const rawDateTime = creditMatch[4].trim();

        const principalSantim = parseSantim(rawAmount);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing Dashen credit amount.' };
        }

        const dateTime = parseEthiopianDateTime(rawDateTime);
        if (!dateTime) {
            warnings.push('Could not parse transaction date. Please confirm the date manually.');
        }

        const balanceMatch = text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;
        const reference = extractDashenReference(text);

        const candidate: ParsedTransactionCandidate = {
            providerId: 'dashen',
            type: 'CREDIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            accountIdentifier: rawAccount,
            accountLast4: extractAccountLast4(rawAccount),
            counterparty,
            reference,
            dateTime: dateTime ?? undefined,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: counterparty ? `Dashen Credit from ${counterparty}` : 'Dashen Account Credit',
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // --- PATTERN 2: Dashen Debit Transaction ---
    // Example: "Dear Customer, your account '1234****5678' is debited with ETB 1,000.00 on 15/10/2026 at 04:10:28 PM. Your current balance is ETB 2,938.38. Dashen Bank - Always one step ahead!"
    const debitMatch = text.match(
        /your\s+account\s+['"]?([^'"]+?)['"]?\s+is\s+debited\s+with\s+ETB\s*([^\s]+)(?:\s+(?:to|for)\s+([^.]+?))?\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+at\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM))/i
    );
    if (debitMatch) {
        const rawAccount = debitMatch[1].trim();
        const rawAmount = debitMatch[2];
        const counterparty = debitMatch[3]?.trim();
        const rawDateTime = debitMatch[4].trim();

        const principalSantim = parseSantim(rawAmount);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing Dashen debit amount.' };
        }

        const dateTime = parseEthiopianDateTime(rawDateTime);
        if (!dateTime) {
            warnings.push('Could not parse transaction date. Please confirm the date manually.');
        }

        const balanceMatch = text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;
        const reference = extractDashenReference(text);

        const candidate: ParsedTransactionCandidate = {
            providerId: 'dashen',
            type: 'DEBIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            accountIdentifier: rawAccount,
            accountLast4: extractAccountLast4(rawAccount),
            counterparty,
            reference,
            dateTime: dateTime ?? undefined,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: counterparty ? `Dashen Payment to ${counterparty}` : 'Dashen Account Debit',
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    return {
        status: 'ambiguous',
        reason: 'Message matches Dashen Bank, but does not match a supported debit or credit format.',
    };
}
