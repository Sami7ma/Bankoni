// sms/__tests__/fingerprint.test.ts
// Unit tests for deterministic duplicate fingerprint generation.

import { describe, expect, it } from '@jest/globals';
import { generateSmsFingerprint } from '../fingerprint';
import type { ParsedTransactionCandidate } from '../types';

describe('SMS Fingerprint Generator', () => {
    const candidateA: Omit<ParsedTransactionCandidate, 'rawSms' | 'warnings'> = {
        providerId: 'cbe',
        type: 'DEBIT',
        principalAmount: 1300,
        ledgerAmount: 1312,
        isLedgerAmountDerived: false,
        currency: 'ETB',
        accountIdentifier: '1000****1234',
        accountLast4: '1234',
        reference: 'FT24112233',
        dateTime: '2026-10-21T10:00:00+03:00',
        currentBalance: 50000,
        description: 'CBE Debit',
    };

    it('generates a 64-character hex SHA-256 string', () => {
        const fp = generateSmsFingerprint(candidateA);
        expect(fp).toHaveLength(64);
        expect(/^[0-9a-f]{64}$/.test(fp)).toBe(true);
    });

    it('is completely deterministic for identical candidates', () => {
        const fp1 = generateSmsFingerprint(candidateA);
        const fp2 = generateSmsFingerprint({ ...candidateA });
        expect(fp1).toBe(fp2);
    });

    it('produces different fingerprints when ledger amount changes', () => {
        const fp1 = generateSmsFingerprint(candidateA);
        const fp2 = generateSmsFingerprint({ ...candidateA, ledgerAmount: 1312.01 });
        expect(fp1).not.toBe(fp2);
    });

    it('produces different fingerprints when transaction type changes', () => {
        const fp1 = generateSmsFingerprint(candidateA);
        const fp2 = generateSmsFingerprint({ ...candidateA, type: 'CREDIT' });
        expect(fp1).not.toBe(fp2);
    });

    it('handles candidates with missing optional fields safely', () => {
        const minimalCandidate: Omit<ParsedTransactionCandidate, 'rawSms' | 'warnings'> = {
            providerId: 'dashen',
            type: 'DEBIT',
            principalAmount: 50,
            ledgerAmount: 50,
            isLedgerAmountDerived: false,
            currency: 'ETB',
            description: 'Minimal',
        };

        const fp = generateSmsFingerprint(minimalCandidate);
        expect(fp).toHaveLength(64);
    });
});
