// sms/__tests__/matcher.test.ts
// Unit tests for SMS candidate wallet matching.

import { describe, expect, it } from '@jest/globals';
import { matchWalletForCandidate } from '../matcher';
import type { ParsedTransactionCandidate } from '../types';
import type { Wallet } from '../../types/Wallet';

describe('Wallet Matcher', () => {
    const mockWallets: Wallet[] = [
        {
            id: 'w-cbe-1',
            name: 'CBE Main',
            icon: 'bank',
            providerId: 'cbe',
            openingBalance: 0,
            balance: 5000,
            currency: 'ETB',
            accountNumberLast4: '1234',
            isDefault: true,
            isArchived: false,
            createdAt: '2026-01-01T00:00:00Z',
        },
        {
            id: 'w-cbe-2',
            name: 'CBE Secondary',
            icon: 'bank',
            providerId: 'cbe',
            openingBalance: 0,
            balance: 1000,
            currency: 'ETB',
            accountNumberLast4: '5678',
            isDefault: false,
            isArchived: false,
            createdAt: '2026-01-01T00:00:00Z',
        },
        {
            id: 'w-telebirr',
            name: 'My Telebirr',
            icon: 'wallet',
            providerId: 'telebirr',
            openingBalance: 0,
            balance: 250,
            currency: 'ETB',
            accountNumberLast4: '9999',
            isDefault: false,
            isArchived: false,
            createdAt: '2026-01-01T00:00:00Z',
        },
        {
            id: 'w-cbe-archived',
            name: 'Old CBE',
            icon: 'bank',
            providerId: 'cbe',
            openingBalance: 0,
            balance: 0,
            currency: 'ETB',
            accountNumberLast4: '1234',
            isDefault: false,
            isArchived: true, // Archived
            createdAt: '2025-01-01T00:00:00Z',
        },
    ];

    const baseCandidate: ParsedTransactionCandidate = {
        providerId: 'cbe',
        type: 'DEBIT',
        principalAmount: 100,
        ledgerAmount: 100,
        isLedgerAmountDerived: false,
        currency: 'ETB',
        description: 'Test',
        rawSms: '',
        warnings: [],
    };

    it('matches exact account last 4 with high confidence', () => {
        const candidate = {
            ...baseCandidate,
            accountLast4: '1234',
        };

        const result = matchWalletForCandidate(candidate, mockWallets);
        expect(result.confidence).toBe('exact_account');
        expect(result.matchedWallet?.id).toBe('w-cbe-1');
        // Does not match the archived wallet
        expect(result.candidateWallets.length).toBe(1);
    });

    it('matches provider_only when candidate has no last 4 and only one provider wallet exists', () => {
        const candidate: ParsedTransactionCandidate = {
            ...baseCandidate,
            providerId: 'telebirr',
            accountLast4: undefined,
        };

        const result = matchWalletForCandidate(candidate, mockWallets);
        expect(result.confidence).toBe('provider_only');
        expect(result.matchedWallet?.id).toBe('w-telebirr');
    });

    it('returns ambiguous when multiple provider wallets exist and last 4 does not resolve them', () => {
        const candidate: ParsedTransactionCandidate = {
            ...baseCandidate,
            providerId: 'cbe',
            accountLast4: undefined, // No account info in message
        };

        const result = matchWalletForCandidate(candidate, mockWallets);
        expect(result.confidence).toBe('ambiguous');
        expect(result.matchedWallet).toBeNull();
        expect(result.candidateWallets.length).toBe(2);
    });

    it('returns none when no wallet exists for the provider', () => {
        const candidate: ParsedTransactionCandidate = {
            ...baseCandidate,
            providerId: 'dashen',
        };

        const result = matchWalletForCandidate(candidate, mockWallets);
        expect(result.confidence).toBe('none');
        expect(result.matchedWallet).toBeNull();
        expect(result.candidateWallets).toHaveLength(0);
    });
});
