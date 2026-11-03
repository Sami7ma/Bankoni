// sms/telecomPackage.ts
//
// Telecom Package Intelligence and Event Model.
// Implements separate service event models (Activation, Usage 75%, Depletion, Expiry)
// and distinguishes them strictly from financial payment events.

import { normalizeSmsText, parseSantim, santimToEtb, parseEthiopianDateTime } from './cleaners';
import type { TelecomEvent, TelecomEventType } from '../types/FinancialRelationships';

export interface TelecomParseResult {
    isTelecomPackage: boolean;
    isFinancialDebit: boolean;
    eventType?: TelecomEventType;
    packageName?: string;
    volumeText?: string;
    usagePercentage?: number;
    expiryTime?: string;
    activationTime?: string;
    price?: number;
    rawText: string;
    description: string;
}

/**
 * Extracts data volume, SMS count, or duration from text (e.g. "360 MB", "720 MB", "960 SMS", "2 hours").
 */
export function extractPackageVolume(text: string): string | undefined {
    const match = text.match(/(\d+(?:\.\d+)?\s*(?:MB|GB|KB|SMS|Minutes|Mins|Hour|Hours|Day|Days))/i);
    return match ? match[1].trim() : undefined;
}

/**
 * Parses incoming telecom SMS messages and classifies them into service events vs financial purchases.
 * Handles all 6 canonical user examples:
 * 1. "Daily Internet Package 360 MB finished." -> DEPLETION
 * 2. "Daily Internet Package 360 MB used 75%, with expiry." -> USAGE_ALERT (75%)
 * 3. "Daily Internet Package 720 MB used 75%, with expiry." -> USAGE_ALERT (75%)
 * 4. "Daily Internet Package 360 MB received, with expiry but no price." -> ACTIVATION
 * 5. "Two-hour unlimited internet offer activated, with activation and expiry." -> ACTIVATION
 * 6. "Telebirr ETB 45 Monthly SMS Package 960 SMS purchase." -> PURCHASE (Financial Debit)
 */
export function parseTelecomPackageSms(rawText: string): TelecomParseResult {
    const text = normalizeSmsText(rawText);

    // ── EXAMPLE 6: Telebirr Package Purchase (Financial Debit) ──
    // Matches explicit price payment for package purchase
    // e.g. "You have paid ETB 45.00 for package Monthly SMS Package 960 SMS purchase on 21/10/2026..."
    // e.g. "Telebirr ETB 45 Monthly SMS Package 960 SMS purchase."
    const purchaseMatch = text.match(
        /(?:paid|bought|purchase)\s+(?:(?:for\s+package|package)\s+)?(.+?)\s+for\s+ETB\s*([\d,.]+)/i
    ) || text.match(
        /(?:paid\s+ETB\s*([\d,.]+)\s+for\s+(?:package\s+)?(.+?)(?:\s+purchase|\s+on|\.|$))/i
    ) || text.match(
        /(?:ETB|Birr)\s*([\d,.]+)\s+(.+?)(?:\s+package)?\s+purchase/i
    );

    if (purchaseMatch) {
        let rawAmount = purchaseMatch[1];
        let pkgName = purchaseMatch[2]?.trim();

        // Handle regex group index variations
        if (isNaN(parseFloat(rawAmount?.replace(/,/g, '') || 'NaN'))) {
            pkgName = purchaseMatch[1]?.trim();
            rawAmount = purchaseMatch[2];
        }

        const santim = parseSantim(rawAmount);
        if (santim && santim > 0 && pkgName) {
            const price = santimToEtb(santim);
            const volume = extractPackageVolume(pkgName);

            return {
                isTelecomPackage: true,
                isFinancialDebit: true,
                eventType: 'PURCHASE',
                packageName: pkgName.replace(/^Telebirr\s+/i, '').trim(),
                volumeText: volume,
                price,
                rawText,
                description: `Package Purchase: ${pkgName} for ETB ${price}`,
            };
        }
    }

    // ── EXAMPLE 1: Depletion / Finished Alert ──
    // e.g. "Daily Internet Package 360 MB finished." or "Your Daily Internet Package 360 MB has finished."
    const depletionMatch = text.match(/(.+?)\s+(?:has\s+)?(?:finished|depleted|ended|exhausted)(?:\.|$)/i);
    if (depletionMatch && !/used\s+\d+%/i.test(text)) {
        const pkgName = depletionMatch[1].replace(/^(?:your|dear\s+customer,?\s*(?:your)?)\s+/i, '').trim();
        const volume = extractPackageVolume(pkgName);

        return {
            isTelecomPackage: true,
            isFinancialDebit: false, // Service event only! Never create zero-value transaction
            eventType: 'DEPLETION',
            packageName: pkgName,
            volumeText: volume,
            rawText,
            description: `Package Depleted: ${pkgName}`,
        };
    }

    // ── EXAMPLES 2 & 3: Usage Threshold Alerts (e.g. 75% Used) ──
    // e.g. "Daily Internet Package 360 MB used 75%, with expiry."
    // e.g. "Dear customer, your Daily Internet Package 720 MB is used 75%. It will expire on 26/10/2026 23:59:59."
    const usageMatch = text.match(/(.+?)\s+(?:is\s+)?used\s+(\d+)%(?:[\s\S]*?(?:expire(?:s)?\s+(?:on|at)|expiry[:\s]+)(.+?)(?:\.|$))?/i);
    if (usageMatch) {
        const pkgName = usageMatch[1].replace(/^(?:your|dear\s+customer,?\s*(?:your)?)\s+/i, '').trim();
        const usagePercentage = parseInt(usageMatch[2], 10);
        const rawExpiry = usageMatch[3]?.trim();
        const expiryTime = rawExpiry ? parseEthiopianDateTime(rawExpiry) ?? rawExpiry : undefined;
        const volume = extractPackageVolume(pkgName);

        return {
            isTelecomPackage: true,
            isFinancialDebit: false, // Service alert only
            eventType: 'USAGE_ALERT',
            packageName: pkgName,
            volumeText: volume,
            usagePercentage,
            expiryTime,
            rawText,
            description: `Package Usage: ${pkgName} used ${usagePercentage}%`,
        };
    }

    // ── EXAMPLE 5: Offer / Package Activated with activation and expiry ──
    // e.g. "Two-hour unlimited internet offer activated, with activation and expiry."
    // e.g. "Two-hour unlimited internet offer activated on 25/10/2026 10:00:00, valid until 25/10/2026 12:00:00."
    const activatedMatch = text.match(/(.+?)\s+(?:has\s+been\s+)?activated(?:[\s\S]*?(?:on|at)\s+(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}))?(?:[\s\S]*?(?:valid\s+until|expire(?:s)?\s+(?:on|at))[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}|[^\n.]+))?/i);
    if (activatedMatch && !text.includes('paid ETB')) {
        const pkgName = activatedMatch[1].replace(/^(?:your|dear\s+customer,?\s*(?:your)?)\s+/i, '').trim();
        const rawActivation = activatedMatch[2];
        const rawExpiry = activatedMatch[3];

        const activationTime = rawActivation ? parseEthiopianDateTime(rawActivation) ?? rawActivation : undefined;
        const expiryTime = rawExpiry ? parseEthiopianDateTime(rawExpiry) ?? rawExpiry : undefined;
        const volume = extractPackageVolume(pkgName);

        return {
            isTelecomPackage: true,
            isFinancialDebit: false, // Service event only
            eventType: 'ACTIVATION',
            packageName: pkgName,
            volumeText: volume,
            activationTime,
            expiryTime,
            rawText,
            description: `Package Activated: ${pkgName}`,
        };
    }

    // ── EXAMPLE 4: Package received with expiry but no price ──
    // e.g. "Daily Internet Package 360 MB received, with expiry but no price."
    // e.g. "You have received Daily Internet Package 360 MB valid until 26/10/2026 23:59:59."
    if ((/received/i.test(text) || /package/i.test(text)) && !text.includes('ETB') && !text.includes('Birr')) {
        let pkgName = '';
        let rawExpiry: string | undefined;

        if (/^(?:you\s+have\s+)?received\s+/i.test(text)) {
            const m = text.match(/^(?:you\s+have\s+)?received\s+(.+?)(?:\s+(?:valid\s+until|expire(?:s)?\s+(?:on|at)|with\s+expiry)[:\s]*([^\n.]+))?(?:\.|$)/i);
            if (m) {
                pkgName = m[1].trim();
                rawExpiry = m[2]?.trim();
            }
        } else {
            const m = text.match(/^(.+?)\s+received(?:[,\s]*(?:with\s+expiry|valid\s+until)[:\s]*([^\n.]+))?/i);
            if (m) {
                pkgName = m[1].trim();
                rawExpiry = m[2]?.trim();
            }
        }

        if (pkgName && /package|mb|gb|internet|sms|voice/i.test(pkgName)) {
            const expiryTime = rawExpiry ? parseEthiopianDateTime(rawExpiry) ?? rawExpiry : undefined;
            const volume = extractPackageVolume(pkgName);

            return {
                isTelecomPackage: true,
                isFinancialDebit: false, // Service event only
                eventType: 'ACTIVATION',
                packageName: pkgName,
                volumeText: volume,
                expiryTime,
                rawText,
                description: `Package Received: ${pkgName}`,
            };
        }
    }

    return {
        isTelecomPackage: false,
        isFinancialDebit: false,
        rawText,
        description: 'Not a recognized telecom package message.',
    };
}
