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
    detectDirectionFromKeywords,
} from '../cleaners';
import type { ParsedTransactionCandidate, SmsParseResult, FeeBreakdown } from '../types';

/**
 * Extracts Telebirr current wallet balance if present in the message text.
 * Supports:
 *   - "Your current balance is ETB 383.83."
 *   - "Your current E-Money Account balance is ETB 103.83."
 *   - "current E-Money Account balance is ETB 103.83"
 *   - "balance is ETB 500.00"
 */
function extractTelebirrBalance(text: string): number | null {
    const match = text.match(/(?:current\s+(?:E-Money\s+Account\s+)?)?balance\s+is\s+ETB\s*([\d,.]+)/i);
    if (match) {
        return parseSantim(match[1]);
    }
    return null;
}

/**
 * Extracts transaction reference from Telebirr SMS text.
 * Examples:
 *   - "Your telebirr transaction number is RA12345678"
 *   - "Your transaction number is DJN07Y99ZQ"
 *   - "by transaction number 2610211327"
 */
function extractTelebirrReference(text: string): string | undefined {
    const match = text.match(/(?:Your\s+)?(?:telebirr\s+)?transaction\s+number\s+is\s+([A-Za-z0-9_-]+)/i);
    if (match) return match[1].replace(/[.,]$/, '');

    const byRefMatch = text.match(/\bby\s+transaction\s+number\s+([A-Za-z0-9_-]+)/i);
    if (byRefMatch) return byRefMatch[1].replace(/[.,]$/, '');

    return undefined;
}

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

        const balanceSantim = extractTelebirrBalance(text);
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
    // Example A (from CBE): "Dear Customer, You have received ETB 1,300.00 by transaction number 2610211327 from Commercial Bank of Ethiopia to your telebirr Account 09****1234 - ABEBE BIKILA. Your current balance is ETB 1,389.83."
    // Example B (P2P/General): "You have received ETB 500.00 from Zelalem(2519****9789) on 23/10/2026 17:22:20. Your transaction number is DJN07Y99ZQ. Your current E-Money Account balance is ETB 603.83."
    // Example C: "Your account has been credited with ETB 500.00 on 23/10/2026 17:22:20 from Zelalem..."
    const incomingMatch = text.match(
        /(?:You\s+have\s+received|Your\s+account\s+has\s+been\s+credited\s+with)\s+ETB\s*([\d,.]+)\s+(?:by\s+transaction\s+number\s+([A-Za-z0-9_-]+)\s+)?(?:on\s+(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}|\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})\s+)?from\s+(.+?)(?:\s+to\s+your\s+telebirr\s+Account\s+([^\s-]+)(?:\s*-\s*([^.]+))?|\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})|\.|$)/i
    );

    if (incomingMatch) {
        const principalSantim = parseSantim(incomingMatch[1]);
        if (principalSantim && principalSantim > 0) {
            const rawRef = incomingMatch[2] || extractTelebirrReference(text);
            const rawDate = incomingMatch[3] || incomingMatch[7];
            const sendingParty = incomingMatch[4]?.trim() ?? 'Sender';
            const account = incomingMatch[5]?.trim();

            const dateTime = rawDate ? parseEthiopianDateTime(rawDate) : undefined;
            if (!dateTime) {
                warnings.push('Could not parse transaction date. Please confirm the date manually.');
            }

            const balanceSantim = extractTelebirrBalance(text);

            const candidate: ParsedTransactionCandidate = {
                providerId: 'telebirr',
                type: 'CREDIT',
                principalAmount: santimToEtb(principalSantim),
                ledgerAmount: santimToEtb(principalSantim),
                isLedgerAmountDerived: false,
                currency: 'ETB',
                accountIdentifier: account,
                accountLast4: account ? extractAccountLast4(account) : undefined,
                counterparty: sendingParty,
                reference: rawRef,
                dateTime: dateTime ?? undefined,
                currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
                description: `Received from ${sendingParty}`,
                rawSms: rawText,
                warnings,
            };

            return { status: 'parsed', candidate };
        }
    }

    // --- PATTERN 3: Telebirr Package Purchases ---
    // Example: "Dear Customer, You have paid ETB 15.00 for package Monthly Unlimited Internet purchase made for 09****1234 on 20/10/2026 15:56:37. Your transaction number is TRX987654. Your current balance is ETB 150.00."
    // Also matches "You have bought package Daily Internet Package for ETB 10.00..."
    const packageMatch = text.match(
        /You\s+have\s+paid\s+ETB\s*([\d,.]+)\s+for\s+package\s+(.+?)\s+(?:purchase\s+made\s+for|purchase\s+for)\s+([^\s]+)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/i
    ) || text.match(
        /You\s+have\s+(?:paid|bought)\s+(?:package\s+)?(.+?)\s+(?:for|of)\s+ETB\s*([\d,.]+)\s+(?:made\s+for\s+([^\s]+)\s+)?on\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/i
    );

    if (packageMatch) {
        // Handle argument order differences between the two regexes
        let rawAmount = packageMatch[1];
        let packageDesc = packageMatch[2]?.trim() ?? 'Package';
        let phone = packageMatch[3]?.replace(/[.,]$/, '');
        let rawDate = packageMatch[4];

        if (isNaN(parseFloat(rawAmount.replace(/,/g, '')))) {
            packageDesc = packageMatch[1]?.trim() ?? 'Package';
            rawAmount = packageMatch[2];
            phone = packageMatch[3]?.replace(/[.,]$/, '');
            rawDate = packageMatch[4];
        }

        const principalSantim = parseSantim(rawAmount);
        if (principalSantim && principalSantim > 0) {
            const dateTime = parseEthiopianDateTime(rawDate);
            if (!dateTime) {
                warnings.push('Could not parse transaction date. Please confirm the date manually.');
            }

            const reference = extractTelebirrReference(text);
            const balanceSantim = extractTelebirrBalance(text);

            const candidate: ParsedTransactionCandidate = {
                providerId: 'telebirr',
                type: 'DEBIT',
                principalAmount: santimToEtb(principalSantim),
                ledgerAmount: santimToEtb(principalSantim),
                isLedgerAmountDerived: false,
                currency: 'ETB',
                accountIdentifier: phone,
                accountLast4: phone ? extractAccountLast4(phone) : undefined,
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
    }

    // --- PATTERN 4: Telebirr General Outgoing Payment, P2P Transfer, or Merchant Payment ---
    // Example A: "Dear Customer, You have transferred ETB 200.00 to 09****5678 (ABEBE) on 21/10/2026 14:00:00. Your transaction number is RA8888. Your current balance is ETB 183.83."
    // Example B: "Dear Customer, You have transferred ETB 50.00 to Zelalem(2519****9789) on 23/10/2026 17:22:20. Your transaction number is DJN07Y99ZQ. Your current E-Money Account balance is ETB 103.83."
    // Example C: "Your account has been debited with ETB 100.00 for transfer to Zelalem(2519****9789) on 23/10/2026 17:22:20."
    // Example D: "Dear Customer, You have paid ETB 250.00 to Merchant Tomoca Coffee on 23/10/2026 10:15:00."
    const generalTransferMatch = text.match(
        /(?:You\s+have\s+(?:transferred|paid)|Your\s+account\s+has\s+been\s+debited\s+with)\s+ETB\s*([\d,.]+)\s+(?:(?:for\s+transfer\s+)?to|for)\s+(.+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/i
    );

    if (generalTransferMatch) {
        const principalSantim = parseSantim(generalTransferMatch[1]);
        if (principalSantim && principalSantim > 0) {
            const recipient = generalTransferMatch[2].trim();
            const rawDate = generalTransferMatch[3];
            const dateTime = parseEthiopianDateTime(rawDate);

            const reference = extractTelebirrReference(text);
            const balanceSantim = extractTelebirrBalance(text);

            const isPackage = /package|bundle|internet/i.test(recipient);
            const isMerchant = /merchant/i.test(recipient);
            const cleanRecipient = recipient.replace(/^Merchant\s+/i, '');

            let desc = `Payment to ${cleanRecipient}`;
            if (isPackage) {
                desc = `Internet Package: ${cleanRecipient}`;
            } else if (text.includes('transferred')) {
                desc = `Transfer to ${cleanRecipient}`;
            }

            const candidate: ParsedTransactionCandidate = {
                providerId: 'telebirr',
                type: 'DEBIT',
                principalAmount: santimToEtb(principalSantim),
                ledgerAmount: santimToEtb(principalSantim),
                isLedgerAmountDerived: false,
                currency: 'ETB',
                counterparty: cleanRecipient,
                reference,
                dateTime: dateTime ?? undefined,
                currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
                description: desc,
                rawSms: rawText,
                warnings,
            };

            return { status: 'parsed', candidate };
        }
    }

    // --- RESILIENT UNIVERSAL FALLBACK FOR TELEBIRR ---
    // Handles unstructured messages, merchant notifications, USSD receipts,
    // or partial SMS clips (e.g. "Zelalem(2519****9789) on 23/10/2026 17:22:20. Your transaction number is DJN07Y99ZQ. Your current E-Money Account balance is ETB 103.83. Thank you for using telebirr Ethio telecom")
    const reference = extractTelebirrReference(text);
    const balanceSantim = extractTelebirrBalance(text);

    // Date extraction: find any Ethiopian date/timestamp
    const dateMatch = text.match(
        /(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?|\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2})/i
    );
    const dateTime = dateMatch ? parseEthiopianDateTime(dateMatch[1]) : undefined;
    if (!dateTime) {
        warnings.push('Could not parse transaction timestamp. Please confirm the date.');
    }

    // Direction detection
    const direction = detectDirectionFromKeywords(text, 'DEBIT');

    // Amount extraction: find ETB amounts that do NOT match the extracted balance
    let principalSantim: number | null = null;
    const amountRegex = /(?:ETB|Birr)\s*([\d,.]+)|([\d,.]+)\s*(?:ETB|Birr)/gi;
    let amtMatch: RegExpExecArray | null;
    while ((amtMatch = amountRegex.exec(text)) !== null) {
        const amtStr = amtMatch[1] || amtMatch[2];
        const parsed = parseSantim(amtStr);
        if (parsed != null && parsed > 0 && parsed !== balanceSantim) {
            principalSantim = parsed;
            break;
        }
    }

    if (!principalSantim || principalSantim <= 0) {
        principalSantim = 0;
        warnings.push('Transaction amount was not found in the SMS text. Please confirm the amount before importing.');
    }

    // Counterparty extraction
    let counterparty: string | undefined = undefined;
    const leadingNameMatch = text.match(/^([A-Za-z\s]+(?:\([0-9*+]+\))?)/);
    const toMatch = text.match(/(?:to|for)\s+(?!using\b|package\b|purchase\b)([A-Za-z0-9_().*+\-\s]{3,35}?)(?:\s+on|\s+Your|\.|$)/i);
    const fromMatch = text.match(/(?:from)\s+([A-Za-z0-9_().*+\-\s]{3,35}?)(?:\s+on|\s+to|\s+Your|\.|$)/i);

    if (leadingNameMatch && leadingNameMatch[1].trim() && !/^(?:Dear|You|Your|Thank)/i.test(leadingNameMatch[1])) {
        counterparty = leadingNameMatch[1].trim();
    } else if (direction.type === 'CREDIT' && fromMatch) {
        counterparty = fromMatch[1].trim();
    } else if (toMatch) {
        counterparty = toMatch[1].trim();
    }

    // Description & Category Hint
    let description = 'Telebirr Transaction';
    const isPackage = /package|bundle|internet|data/i.test(text);
    const isMerchant = /merchant|shop|store|supermarket|hotel|cafe|restaurant|tomoca/i.test(text);

    if (isPackage) {
        description = 'Internet Package';
    } else if (isMerchant && counterparty) {
        description = `Payment to ${counterparty}`;
    } else if (counterparty) {
        description = direction.type === 'DEBIT' ? `Transfer to ${counterparty}` : `Transfer from ${counterparty}`;
    } else if (direction.type === 'CREDIT') {
        description = 'Telebirr Deposit';
    }

    // Phone / Account number
    const phoneMatch = text.match(/(?:account|made\s+for|phone|number\s+is\s+)?(09\d{8}|07\d{8}|09\*{2,4}\d{4}|2519\*{2,4}\d{4})/i);
    const accountIdentifier = phoneMatch ? phoneMatch[1] : undefined;

    const candidate: ParsedTransactionCandidate = {
        providerId: 'telebirr',
        type: direction.type,
        principalAmount: santimToEtb(principalSantim),
        ledgerAmount: santimToEtb(principalSantim),
        isLedgerAmountDerived: false,
        currency: 'ETB',
        accountIdentifier,
        accountLast4: accountIdentifier ? extractAccountLast4(accountIdentifier) : undefined,
        counterparty,
        reference,
        dateTime: dateTime || undefined,
        currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
        description,
        rawSms: rawText,
        warnings,
    };

    return { status: 'parsed', candidate };
}
