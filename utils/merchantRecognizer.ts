// utils/merchantRecognizer.ts
//
// Local-first merchant recognition, normalization, and categorization rules.
// Distinguishes merchant identity from payment intermediaries and learns from user choices.

import type { Merchant, MerchantRule, MerchantType } from '../types/FinancialRelationships';

export interface MerchantRecognitionResult {
    isMerchant: boolean;
    merchantName: string;
    normalizedName: string;
    merchantType?: MerchantType;
    suggestedCategoryId?: string;
    matchedRule?: MerchantRule;
    isRemembered: boolean;
}

const PAYMENT_INTERMEDIARIES = [
    /\btelebirr\b/i,
    /\bethio\s+telecom\b/i,
    /\bcommercial\s+bank\s+of\s+ethiopia\b/i,
    /\bcbe\s+birr\b/i,
    /\bcbe\b/i,
    /\bdashen(?:\s+bank)?\b/i,
    /\bawash(?:\s+bank)?\b/i,
    /\bbank\s+of\s+abyssinia\b/i,
    /\bboa\b/i,
    /\bm-?pesa\b/i,
    /\bsafaricom\b/i,
    /\bchapa\b/i,
];

const LEGAL_SUFFIXES = [
    /\b(?:p\.?l\.?c\.?|plc|s\.?c\.?|sc|llc|ltd|inc|corp)\b/gi,
    /\bbranch\s+\d+\b/gi,
    /\b(?:bole|sarbet|piassa|kazanchis|mexico|gerji|cmc|megenagna|hayahulet)\s+branch\b/gi,
];

const PREFIX_PATTERNS = [
    /^merchant\s+/i,
    /^to\s+merchant\s+/i,
    /^to\s+/i,
    /^paid\s+to\s+/i,
    /^payment\s+to\s+/i,
];

/**
 * Normalizes a raw merchant name or counterparty text conservatively.
 * Removes legal suffixes, branch labels, intermediary prefixes, and extra punctuation.
 */
export function normalizeMerchantName(raw: string): string {
    if (!raw) return '';
    let cleaned = raw.trim();

    // 1. Strip leading prefix keywords
    for (const prefix of PREFIX_PATTERNS) {
        cleaned = cleaned.replace(prefix, '');
    }

    // 2. Strip legal suffixes and branch designations
    for (const suffix of LEGAL_SUFFIXES) {
        cleaned = cleaned.replace(suffix, '');
    }

    // 3. Remove punctuation and collapse spaces
    cleaned = cleaned
        .replace(/['’.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    return cleaned;
}

/**
 * Checks if the counterparty string actually represents a payment intermediary
 * rather than the end merchant.
 */
export function isPaymentIntermediary(name: string): boolean {
    const trimmed = name.trim();
    for (const intermediary of PAYMENT_INTERMEDIARIES) {
        if (intermediary.test(trimmed)) {
            // If the name is strictly the intermediary, e.g. "Telebirr" or "CBE"
            const withoutIntermediary = trimmed.replace(intermediary, '').replace(/[()-\s]/g, '');
            if (withoutIntermediary.length === 0) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Detects merchant type based on domain keyword heuristics.
 */
export function detectMerchantType(name: string): MerchantType | undefined {
    const lower = name.toLowerCase();

    // Coffee shops
    if (/\b(?:coffee|cafe|café|bunna|espresso|roastery|tomoca|to\.mo\.ca|kaldi'?s?)\b/i.test(lower)) {
        return 'coffee_shop';
    }

    // Bakeries
    if (/\b(?:bakery|pastry|cake|mulmul|patisserie|bread|ዳቦ|ኬክ)\b/i.test(lower)) {
        return 'bakery';
    }

    // Restaurants
    if (/\b(?:restaurant|bistro|grill|kitchen|burger|pizza|eatery|lounge|bar\s*&\s*restaurant|diner|buffet|tibs|shiro|ምግብ\s*ቤት)\b/i.test(lower)) {
        return 'restaurant';
    }

    // Food shops & Groceries
    if (/\b(?:supermarket|grocery|mart|hypermarket|minimarket|market|store|food\s*shop|ሱፐርማርኬት)\b/i.test(lower)) {
        return 'groceries';
    }

    return undefined;
}

/**
 * Maps a recognized merchant type to a default category ID from existing built-in categories.
 */
export function getDefaultCategoryForMerchantType(type?: MerchantType): string | undefined {
    switch (type) {
        case 'coffee_shop':
            return 'cat-2'; // Breakfast / Coffee
        case 'restaurant':
            return 'cat-3'; // Lunch / Dining
        case 'bakery':
            return 'cat-4'; // Groceries / Bakery
        case 'groceries':
            return 'cat-4'; // Groceries
        default:
            return undefined;
    }
}

/**
 * Identifies and classifies a merchant from transaction counterparty or description.
 * Checks existing remembered merchants/rules first, then falls back to heuristics.
 */
export function recognizeMerchant(
    counterpartyText: string,
    rememberedRules: MerchantRule[] = [],
    rememberedMerchants: Merchant[] = []
): MerchantRecognitionResult {
    const trimmed = counterpartyText?.trim() || '';
    if (!trimmed || isPaymentIntermediary(trimmed)) {
        return {
            isMerchant: false,
            merchantName: trimmed,
            normalizedName: '',
            isRemembered: false,
        };
    }

    const normalized = normalizeMerchantName(trimmed);
    if (!normalized) {
        return {
            isMerchant: false,
            merchantName: trimmed,
            normalizedName: '',
            isRemembered: false,
        };
    }

    // 1. Check remembered rules first
    const matchedRule = rememberedRules.find((r) => {
        const patternNorm = normalizeMerchantName(r.pattern);
        return patternNorm === normalized || normalized.includes(patternNorm);
    });

    if (matchedRule) {
        const merchant = rememberedMerchants.find((m) => m.id === matchedRule.merchantId);
        return {
            isMerchant: true,
            merchantName: merchant?.name || trimmed,
            normalizedName: normalized,
            merchantType: merchant?.merchantType,
            suggestedCategoryId: matchedRule.categoryId,
            matchedRule,
            isRemembered: true,
        };
    }

    // 2. Check remembered merchants
    const rememberedMerchant = rememberedMerchants.find(
        (m) => m.normalizedName === normalized || normalized.includes(m.normalizedName)
    );

    if (rememberedMerchant) {
        return {
            isMerchant: true,
            merchantName: rememberedMerchant.name,
            normalizedName: normalized,
            merchantType: rememberedMerchant.merchantType,
            suggestedCategoryId: rememberedMerchant.defaultCategoryId,
            isRemembered: true,
        };
    }

    // 3. Heuristic recognition for restaurants, coffee shops, bakeries, groceries
    const detectedType = detectMerchantType(trimmed) || detectMerchantType(normalized);
    const isExplicitMerchantKeyword = /^merchant\s+/i.test(trimmed) || /\bmerchant\b/i.test(trimmed);

    if (detectedType || isExplicitMerchantKeyword) {
        // Clean display name
        const cleanDisplayName = trimmed.replace(/^merchant\s+/i, '').replace(/^to\s+/i, '').trim();
        return {
            isMerchant: true,
            merchantName: cleanDisplayName,
            normalizedName: normalized,
            merchantType: detectedType,
            suggestedCategoryId: getDefaultCategoryForMerchantType(detectedType),
            isRemembered: false,
        };
    }

    return {
        isMerchant: false,
        merchantName: trimmed,
        normalizedName: normalized,
        isRemembered: false,
    };
}
