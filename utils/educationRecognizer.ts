// utils/educationRecognizer.ts
//
// Education-payment recognition workflow.
// Identifies school, college, university, academy, and tuition descriptions.
// Applies default selections (Frequency: Semester, Fee type: Tuition) and remembers local choices.

import type {
    EducationInstitution,
    EducationFrequency,
    EducationFeeType,
} from '../types/FinancialRelationships';

export interface EducationRecognitionResult {
    isEducation: boolean;
    institutionName: string;
    normalizedName: string;
    frequency: EducationFrequency;
    feeType: EducationFeeType;
    suggestedCategoryId?: string;
    matchedInstitution?: EducationInstitution;
    isRemembered: boolean;
}

const EDUCATION_KEYWORDS = [
    /\bschool\b/i,
    /\bcollege\b/i,
    /\buniversity\b/i,
    /\bacademy\b/i,
    /\btuition\b/i,
    /\bkindergarten\b/i,
    /\bcampus\b/i,
    /\binstitute\b/i,
    /ትምህርት/i,
    /ዩኒቨርሲቲ/i,
    /ኮሌጅ/i,
    /አካዳሚ/i,
];

const FEE_TYPE_PATTERNS: Array<{ pattern: RegExp; feeType: EducationFeeType }> = [
    { pattern: /\btuition(?:\s+fee)?\b/i, feeType: 'Tuition' },
    { pattern: /\bregistration(?:\s+fee)?\b/i, feeType: 'Registration' },
    { pattern: /\btransport(?:\s+fee)?\b/i, feeType: 'Transport' },
    { pattern: /\b(?:books?|materials?)\b/i, feeType: 'Books/Materials' },
    { pattern: /\buniform\b/i, feeType: 'Uniform' },
];

const FREQUENCY_PATTERNS: Array<{ pattern: RegExp; frequency: EducationFrequency }> = [
    { pattern: /\bsemester\b/i, frequency: 'Semester' },
    { pattern: /\bannual(?:ly)?|yearly\b/i, frequency: 'Annual' },
    { pattern: /\bquarterly\b/i, frequency: 'Quarterly' },
    { pattern: /\bmonthly\b/i, frequency: 'Monthly' },
    { pattern: /\bone-?off|one-?time\b/i, frequency: 'One-off' },
];

/**
 * Normalizes an educational institution name conservatively.
 */
export function normalizeInstitutionName(raw: string): string {
    if (!raw) return '';
    return raw
        .trim()
        .replace(/^to\s+/i, '')
        .replace(/^payment\s+to\s+/i, '')
        .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Detects if a text string contains educational keywords.
 * Guards against classifying general personal transfers or payment intermediaries.
 */
export function hasEducationKeywords(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    return EDUCATION_KEYWORDS.some((kw) => kw.test(text));
}

/**
 * Extracts institution name from description or counterparty.
 */
export function extractInstitutionName(text: string): string {
    const cleaned = text
        .replace(/^payment\s+(?:for|to)\s+/i, '')
        .replace(/^tuition\s+fee\s+(?:for|to)\s+/i, '')
        .replace(/^to\s+/i, '')
        .trim();

    // If description has "for School of Tomorrow", extract the school name
    const match = cleaned.match(/(?:for|to)\s+([A-Za-z0-9\s'-]+(?:school|college|university|academy|institute|campus)[A-Za-z0-9\s'-]*)/i);
    if (match) {
        return match[1].trim();
    }

    return cleaned;
}

/**
 * Recognizes education payments from counterparty or description.
 * Respects existing remembered choices, otherwise provides defaults:
 * Frequency: Semester, Fee type: Tuition.
 */
export function recognizeEducationPayment(
    text: string,
    counterparty?: string,
    rememberedInstitutions: EducationInstitution[] = []
): EducationRecognitionResult {
    const combinedText = `${counterparty || ''} ${text || ''}`.trim();
    if (!combinedText) {
        return {
            isEducation: false,
            institutionName: '',
            normalizedName: '',
            frequency: 'Semester',
            feeType: 'Tuition',
            isRemembered: false,
        };
    }

    const normalized = normalizeInstitutionName(counterparty || text);

    // 1. Check remembered institutions first
    const matchedInstitution = rememberedInstitutions.find((inst) => {
        const instNorm = normalizeInstitutionName(inst.name);
        return instNorm === normalized || normalized.includes(instNorm) || instNorm.includes(normalized);
    });

    if (matchedInstitution) {
        return {
            isEducation: true,
            institutionName: matchedInstitution.name,
            normalizedName: matchedInstitution.normalizedName,
            frequency: matchedInstitution.preferredFrequency || 'Semester',
            feeType: matchedInstitution.preferredFeeType || 'Tuition',
            suggestedCategoryId: matchedInstitution.defaultCategoryId || 'cat-5', // Default to Books/Education
            matchedInstitution,
            isRemembered: true,
        };
    }

    // 2. Check if text contains education keywords
    if (hasEducationKeywords(combinedText)) {
        const name = extractInstitutionName(counterparty || text);
        const normName = normalizeInstitutionName(name);

        // Extract fee type if specified, otherwise default to Tuition
        let detectedFeeType: EducationFeeType = 'Tuition';
        for (const { pattern, feeType } of FEE_TYPE_PATTERNS) {
            if (pattern.test(combinedText)) {
                detectedFeeType = feeType;
                break;
            }
        }

        // Extract frequency if specified, otherwise default to Semester
        let detectedFrequency: EducationFrequency = 'Semester';
        for (const { pattern, frequency } of FREQUENCY_PATTERNS) {
            if (pattern.test(combinedText)) {
                detectedFrequency = frequency;
                break;
            }
        }

        return {
            isEducation: true,
            institutionName: name,
            normalizedName: normName,
            frequency: detectedFrequency,
            feeType: detectedFeeType,
            suggestedCategoryId: 'cat-5', // Books / Education
            isRemembered: false,
        };
    }

    return {
        isEducation: false,
        institutionName: counterparty || text,
        normalizedName: normalized,
        frequency: 'Semester',
        feeType: 'Tuition',
        isRemembered: false,
    };
}
