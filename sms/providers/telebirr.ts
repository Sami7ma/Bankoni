// sms/providers/telebirr.ts
// Parser implementation for Telebirr (Ethio Telecom) SMS messages.
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

export function parseTelebirrSms(rawText: string): SmsParseResult {
    const text = normalizeSmsText(rawText);
    const warnings: string[] = [];

    // --- PATTERN 1: Telebirr Outgoing Bank Transfer with Fees ---
    // Example: "Dear Customer, You have transferred ETB 1,000.00 successfully from your telebirr account 09****1234 to Commercial Bank of Ethiopia account number 1000****5678 on 21/10/2026 13:28:24. Your telebirr transaction number is RA12345678 and your bank transaction number is FT87654321. The service fee is ETB 5.22 and 15% VAT on the service fee is ETB 0.78. Your current balance is ETB 383.83."
    const bankTransferMatch = text.match(
        /You\s+have\s+transferred\s+ETB\s*([\d,.]+)\s+successfully\s+from\s+your\s+telebirr\s+account\s+([^\s]+)\s+to\s+(.+?)\s+account\s+(?:number\s+)?([^\s]+)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/i
    );

    if (bankTransferMatch) {
        const principalSantim = parseSantim(bankTransferMatch[1]);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing Telebirr transfer amount.' };
        }

        const sourceAccount = bankTransferMatch[2].replace(/[.,]$/, '');
        const destBank = bankTransferMatch[3].trim();
        const destAccount = bankTransferMatch[4].replace(/[.,]$/, '');
        const rawDate = bankTransferMatch[5];

        const dateTime = parseEthiopianDateTime(rawDate);
        if (!dateTime) {
            warnings.push('Could not parse transaction timestamp. Please confirm the date.');
        }

        // References
        const tbRefMatch = text.match(/your\s+telebirr\s+transaction\s+number\s+is\s+([A-Za-z0-9_-]+)/i);
        const bankRefMatch = text.match(/your\s+bank\s+transaction\s+number\s+is\s+([A-Za-z0-9_-]+)/i);
        const reference = tbRefMatch ? tbRefMatch[1] : undefined;
        const secondaryReference = bankRefMatch ? bankRefMatch[1] : undefined;

        // Fees
        const serviceFeeMatch = text.match(/(?:The\s+)?service\s+fee\s+is\s+ETB\s*([\d,.]+)/i);
        const vatMatch = text.match(/(?:15%\s+)?VAT(?:\s+on\s+the\s+service\s+fee)?\s+is\s+ETB\s*([\d,.]+)/i);

        const scSantim = serviceFeeMatch ? parseSantim(serviceFeeMatch[1]) ?? 0 : 0;
        const vatSantim = vatMatch ? parseSantim(vatMatch[1]) ?? 0 : 0;
        const totalFeesSantim = scSantim + vatSantim;

        let feeBreakdown: FeeBreakdown | undefined = undefined;
        let ledgerSantim = principalSantim;
        let isDerived = false;

        if (totalFeesSantim > 0) {
            feeBreakdown = {
                serviceCharge: scSantim > 0 ? santimToEtb(scSantim) : undefined,
                vat: vatSantim > 0 ? santimToEtb(vatSantim) : undefined,
                totalFees: santimToEtb(totalFeesSantim),
            };
            ledgerSantim = principalSantim + totalFeesSantim;
            isDerived = true;
        }

        const balanceMatch = text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;

        const counterpartyDesc = `${destBank} (Acct ${destAccount})`;

        const candidate: ParsedTransactionCandidate = {
            providerId: 'telebirr',
            type: 'DEBIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(ledgerSantim),
            isLedgerAmountDerived: isDerived,
            fees: feeBreakdown,
            currency: 'ETB',
            accountIdentifier: sourceAccount,
            accountLast4: extractAccountLast4(sourceAccount),
            counterparty: counterpartyDesc,
            reference,
            secondaryReference,
            dateTime: dateTime ?? undefined,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: `Transfer to ${destBank}`,
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // --- PATTERN 2: Telebirr Incoming Transfer / Deposit ---
    // Example: "Dear Customer, You have received ETB 1,300.00 by transaction number 2610211327 from Commercial Bank of Ethiopia to your telebirr Account 09****1234 - ABEBE BIKILA. Your current balance is ETB 1,389.83."
    // Also handles YYYY-MM-DD HH:mm:ss or DD/MM/YYYY dates
    const incomingMatch = text.match(
        /You\s+have\s+received\s+ETB\s*([\d,.]+)\s+by\s+transaction\s+number\s+([A-Za-z0-9_-]+)\s+on\s+(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}|\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})\s+from\s+(.+?)\s+to\s+your\s+telebirr\s+Account\s+([^\s-]+)(?:\s*-\s*([^.]+))?/i
    );

    if (incomingMatch) {
        const principalSantim = parseSantim(incomingMatch[1]);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing Telebirr incoming amount.' };
        }

        const reference = incomingMatch[2];
        const rawDate = incomingMatch[3];
        const sendingInstitution = incomingMatch[4].trim();
        const account = incomingMatch[5].trim();
        const accountHolder = incomingMatch[6]?.trim();

        const dateTime = parseEthiopianDateTime(rawDate);
        if (!dateTime) {
            warnings.push('Could not parse transaction date. Please confirm the date manually.');
        }

        const balanceMatch = text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;

        const candidate: ParsedTransactionCandidate = {
            providerId: 'telebirr',
            type: 'CREDIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            accountIdentifier: account,
            accountLast4: extractAccountLast4(account),
            counterparty: sendingInstitution,
            reference,
            dateTime: dateTime ?? undefined,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: `Deposit from ${sendingInstitution}`,
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // --- PATTERN 3: Telebirr Package Purchases ---
    // Example: "Dear Customer, You have paid ETB 15.00 for package Monthly Unlimited Internet purchase made for 09****1234 on 20/10/2026 15:56:37. Your transaction number is TRX987654. Your current balance is ETB 150.00."
    const packageMatch = text.match(
        /You\s+have\s+paid\s+ETB\s*([\d,.]+)\s+for\s+package\s+(.+?)\s+(?:purchase\s+made\s+for|purchase\s+for)\s+([^\s]+)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/i
    );

    if (packageMatch) {
        const principalSantim = parseSantim(packageMatch[1]);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing package purchase amount.' };
        }

        const packageDesc = packageMatch[2].trim();
        const phone = packageMatch[3].replace(/[.,]$/, '');
        const rawDate = packageMatch[4];

        const dateTime = parseEthiopianDateTime(rawDate);
        if (!dateTime) {
            warnings.push('Could not parse transaction date. Please confirm the date manually.');
        }

        const refMatch = text.match(/(?:Your\s+)?transaction\s+number\s+is\s+([A-Za-z0-9_-]+)/i);
        const reference = refMatch ? refMatch[1] : undefined;

        const balanceMatch = text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;

        const candidate: ParsedTransactionCandidate = {
            providerId: 'telebirr',
            type: 'DEBIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            accountIdentifier: phone,
            accountLast4: extractAccountLast4(phone),
            counterparty: 'Ethio telecom',
            reference,
            dateTime: dateTime ?? undefined,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: `Package: ${packageDesc}`,
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // --- PATTERN 4: Telebirr General Outgoing Payment or P2P Transfer ---
    // Example: "Dear Customer, You have transferred ETB 200.00 to 09****5678 (ABEBE) on 21/10/2026 14:00:00. Your transaction number is RA8888. Your current balance is ETB 183.83."
    const generalTransferMatch = text.match(
        /You\s+have\s+(?:transferred|paid)\s+ETB\s*([\d,.]+)\s+(?:to|for)\s+(.+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/i
    );

    if (generalTransferMatch) {
        const principalSantim = parseSantim(generalTransferMatch[1]);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing Telebirr payment amount.' };
        }

        const recipient = generalTransferMatch[2].trim();
        const rawDate = generalTransferMatch[3];
        const dateTime = parseEthiopianDateTime(rawDate);

        const refMatch = text.match(/(?:Your\s+)?transaction\s+number\s+is\s+([A-Za-z0-9_-]+)/i);
        const reference = refMatch ? refMatch[1] : undefined;

        const balanceMatch = text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;

        const candidate: ParsedTransactionCandidate = {
            providerId: 'telebirr',
            type: 'DEBIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            counterparty: recipient,
            reference,
            dateTime: dateTime ?? undefined,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: `Payment to ${recipient}`,
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    return {
        status: 'ambiguous',
        reason: 'Message matches Telebirr, but does not match a supported transfer, deposit, or package purchase structure.',
    };
}
