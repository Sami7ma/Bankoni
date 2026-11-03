// utils/__tests__/merchantRecognizer.test.ts

import { describe, expect, it } from '@jest/globals';
import {
    recognizeMerchant,
    normalizeMerchantName,
    isPaymentIntermediary,
    detectMerchantType,
} from '../merchantRecognizer';
import type { Merchant, MerchantRule } from '../../types/FinancialRelationships';

describe('Merchant Recognition & Categorization Engine', () => {
    describe('normalizeMerchantName', () => {
        it('normalizes merchant aliases conservatively and strips legal suffixes', () => {
            expect(normalizeMerchantName('Merchant Tomoca Coffee P.L.C.')).toBe('tomoca coffee');
            expect(normalizeMerchantName('Mulmul Bakery PLC - Sarbet Branch')).toBe('mulmul bakery');
            expect(normalizeMerchantName('Shoa Supermarket S.C. Branch 1')).toBe('shoa supermarket');
            expect(normalizeMerchantName('To Kaldi\'s Coffee Bole Branch')).toBe('kaldi s coffee');
        });
    });

    describe('isPaymentIntermediary', () => {
        it('detects payment intermediaries accurately', () => {
            expect(isPaymentIntermediary('telebirr')).toBe(true);
            expect(isPaymentIntermediary('Ethio Telecom')).toBe(true);
            expect(isPaymentIntermediary('Commercial Bank of Ethiopia')).toBe(true);
            expect(isPaymentIntermediary('CBE')).toBe(true);
            expect(isPaymentIntermediary('M-PESA')).toBe(true);
            expect(isPaymentIntermediary('Tomoca Coffee')).toBe(false);
            expect(isPaymentIntermediary('Mulmul Bakery')).toBe(false);
        });
    });

    describe('detectMerchantType', () => {
        it('identifies restaurants, coffee shops, bakeries, and groceries', () => {
            expect(detectMerchantType('Tomoca Coffee')).toBe('coffee_shop');
            expect(detectMerchantType('Kaldi\'s Cafe')).toBe('coffee_shop');
            expect(detectMerchantType('Mulmul Bakery')).toBe('bakery');
            expect(detectMerchantType('Bole Cake Pastry')).toBe('bakery');
            expect(detectMerchantType('Castelli Restaurant')).toBe('restaurant');
            expect(detectMerchantType('Habesha Tibs & Grill')).toBe('restaurant');
            expect(detectMerchantType('Shoa Supermarket')).toBe('groceries');
            expect(detectMerchantType('Novis Minimarket')).toBe('groceries');
            expect(detectMerchantType('Abebe Bikila')).toBeUndefined();
        });
    });

    describe('recognizeMerchant', () => {
        it('recognizes unknown merchants by domain heuristics and maps suggested category', () => {
            const result = recognizeMerchant('Merchant Tomoca Coffee');
            expect(result.isMerchant).toBe(true);
            expect(result.merchantType).toBe('coffee_shop');
            expect(result.suggestedCategoryId).toBe('cat-2'); // Breakfast / Coffee
            expect(result.isRemembered).toBe(false);
        });

        it('does not classify payment intermediaries as merchants', () => {
            const result = recognizeMerchant('Telebirr');
            expect(result.isMerchant).toBe(false);
        });

        it('reuses remembered merchant rules and categories', () => {
            const rememberedMerchants: Merchant[] = [
                {
                    id: 'm_1',
                    name: 'Tomoca Coffee',
                    normalizedName: 'tomoca coffee',
                    merchantType: 'coffee_shop',
                    defaultCategoryId: 'cat-2',
                    createdAt: '2026-01-01',
                },
            ];

            const rememberedRules: MerchantRule[] = [
                {
                    id: 'r_1',
                    pattern: 'tomoca',
                    merchantId: 'm_1',
                    categoryId: 'cat-2',
                    autoApply: true,
                    createdAt: '2026-01-01',
                },
            ];

            const result = recognizeMerchant('To Tomoca Roastery Branch', rememberedRules, rememberedMerchants);
            expect(result.isMerchant).toBe(true);
            expect(result.isRemembered).toBe(true);
            expect(result.suggestedCategoryId).toBe('cat-2');
            expect(result.merchantName).toBe('Tomoca Coffee');
        });

        it('does not infer a merchant category from an ambiguous note alone', () => {
            const result = recognizeMerchant('Payment for stuff');
            expect(result.isMerchant).toBe(false);
            expect(result.suggestedCategoryId).toBeUndefined();
        });
    });
});
