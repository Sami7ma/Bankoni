// utils/__tests__/educationRecognizer.test.ts

import { describe, expect, it } from '@jest/globals';
import {
    recognizeEducationPayment,
    normalizeInstitutionName,
    hasEducationKeywords,
} from '../educationRecognizer';
import type { EducationInstitution } from '../../types/FinancialRelationships';

describe('Education Payment Recognition Engine', () => {
    describe('hasEducationKeywords', () => {
        it('detects educational keywords accurately', () => {
            expect(hasEducationKeywords('School of Tomorrow')).toBe(true);
            expect(hasEducationKeywords('Addis Ababa University')).toBe(true);
            expect(hasEducationKeywords('Unity College')).toBe(true);
            expect(hasEducationKeywords('Lideta Academy')).toBe(true);
            expect(hasEducationKeywords('Payment for tuition fee')).toBe(true);
            expect(hasEducationKeywords('ቅዱስ ጊዮርጊስ ትምህርት ቤት')).toBe(true);
            expect(hasEducationKeywords('Zelalem Birr Transfer')).toBe(false);
            expect(hasEducationKeywords('Telebirr cash-in')).toBe(false);
        });
    });

    describe('recognizeEducationPayment', () => {
        it('preselects Frequency: Semester and Fee type: Tuition on first recognition', () => {
            const result = recognizeEducationPayment('Tuition fee payment', 'School of Tomorrow');
            expect(result.isEducation).toBe(true);
            expect(result.frequency).toBe('Semester');
            expect(result.feeType).toBe('Tuition');
            expect(result.institutionName).toBe('School of Tomorrow');
            expect(result.isRemembered).toBe(false);
        });

        it('extracts institution from description when counterparty is generic', () => {
            const result = recognizeEducationPayment('Payment for Sandford International School tuition');
            expect(result.isEducation).toBe(true);
            expect(result.frequency).toBe('Semester');
            expect(result.feeType).toBe('Tuition');
            expect(result.isRemembered).toBe(false);
        });

        it('reuses remembered institution choices and user edits locally', () => {
            const rememberedInstitutions: EducationInstitution[] = [
                {
                    id: 'edu_1',
                    name: 'Gibson School Systems',
                    normalizedName: 'gibson school systems',
                    preferredFrequency: 'Quarterly', // User had previously edited this to Quarterly
                    preferredFeeType: 'Transport',   // User had previously edited this to Transport
                    defaultCategoryId: 'cat-5',
                    createdAt: '2026-01-01',
                },
            ];

            const result = recognizeEducationPayment(
                'Tuition fee',
                'Gibson School Systems',
                rememberedInstitutions
            );

            expect(result.isEducation).toBe(true);
            expect(result.isRemembered).toBe(true);
            expect(result.frequency).toBe('Quarterly');
            expect(result.feeType).toBe('Transport');
            expect(result.suggestedCategoryId).toBe('cat-5');
        });

        it('does not infer that every payment to a person is an education payment', () => {
            const result = recognizeEducationPayment('Transfer to Abebe', 'Abebe Bikila');
            expect(result.isEducation).toBe(false);
        });
    });
});
