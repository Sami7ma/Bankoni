// sms/__tests__/integration.test.ts
// Integration tests covering the entire SMS Import lifecycle:
// Parsing -> Validation -> Fingerprinting -> Wallet Matching -> Deduplication -> Reconciliation rules.

import { describe, expect, it } from '@jest/globals';
import { parseSms } from '../index';
import { matchWalletForCandidate } from '../matcher';
import { generateSmsFingerprint } from '../fingerprint';
import type { Wallet } from '../../types/Wallet';
import type { Category } from '../../types/Category';
import type { Transaction } from '../../types/Transaction';

describe('SMS Import & Parsing Integration Tests', () => {
    const mockWallets: Wallet[] = [
        {
            id: 'w-cbe-primary',
            name: 'CBE Main Account',
            icon: 'bank',
            providerId: 'cbe',
            openingBalance: 5000,
            balance: 5000,
            currency: 'ETB',
            accountNumberLast4: '1234',
            isDefault: true,
            isArchived: false,
            createdAt: '2026-01-01T00:00:00Z',
        },
        {
            id: 'w-cbe-savings',
            name: 'CBE Savings',
            icon: 'bank',
            providerId: 'cbe',
            openingBalance: 10000,
            balance: 10000,
            currency: 'ETB',
            accountNumberLast4: '9999',
            isDefault: false,
            isArchived: false,
            createdAt: '2026-01-01T00:00:00Z',
        },
        {
            id: 'w-telebirr',
            name: 'Personal Telebirr',
            icon: 'smartphone',
            providerId: 'telebirr',
            openingBalance: 1500,
            balance: 1500,
            currency: 'ETB',
            accountNumberLast4: '4321',
            isDefault: false,
            isArchived: false,
            createdAt: '2026-01-01T00:00:00Z',
        },
        {
            id: 'w-dashen',
            name: 'Dashen Salary',
            icon: 'building',
            providerId: 'dashen',
            openingBalance: 8000,
            balance: 8000,
            currency: 'ETB',
            accountNumberLast4: '5678',
            isDefault: false,
            isArchived: false,
            createdAt: '2026-01-01T00:00:00Z',
        },
    ];

    const mockCategories: Category[] = [
        {
            id: 'cat-groceries',
            name: 'Groceries',
            iconKey: 'shopping-cart',
            flow: 'EXPENSE',
            essential: true,
            recurring: false,
            isBuiltIn: true,
            isCustom: false,
        },
        {
            id: 'cat-utilities',
            name: 'Bills & Utilities',
            iconKey: 'zap',
            flow: 'EXPENSE',
            essential: true,
            recurring: true,
            isBuiltIn: true,
            isCustom: false,
        },
        {
            id: 'cat-salary',
            name: 'Salary',
            iconKey: 'briefcase',
            flow: 'INCOME',
            essential: false,
            recurring: true,
            isBuiltIn: true,
            isCustom: false,
        },
        {
            id: 'cat-transfers',
            name: 'Transfers Received',
            iconKey: 'arrow-down',
            flow: 'INCOME',
            essential: false,
            recurring: false,
            isBuiltIn: true,
            isCustom: false,
        },
    ];

    it('successfully processes full CBE debit flow with fee reconciliation and exact wallet match', () => {
        const sms =
            'Dear Customer, A debit transaction of ETB 1300.0 has occurred on your account 1000****1234. ' +
            'Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB1312.00. ' +
            'Your current balance is ETB840,060.64. Thanks for Banking with CBE. https://apps.cbe.com.et:100/?id=FT2610123456';

        // Step 1: Parse
        const parseResult = parseSms(sms);
        expect(parseResult.status).toBe('parsed');
        if (parseResult.status !== 'parsed') return;

        const candidate = parseResult.candidate;

        // Step 2: Arithmetic verification
        expect(candidate.principalAmount).toBe(1300);
        expect(candidate.ledgerAmount).toBe(1312); // Must be total deducted
        expect(candidate.fees?.totalFees).toBe(12);

        // Step 3: Match wallet
        const walletOutcome = matchWalletForCandidate(candidate, mockWallets);
        expect(walletOutcome.confidence).toBe('exact_account');
        expect(walletOutcome.matchedWallet?.id).toBe('w-cbe-primary');

        // Step 4: Reconcile Category Flow (DEBIT -> EXPENSE)
        const validExpenseCategories = mockCategories.filter(
            (c) => (candidate.type === 'DEBIT' ? c.flow === 'EXPENSE' : c.flow === 'INCOME')
        );
        expect(validExpenseCategories.map((c) => c.name)).toEqual(['Groceries', 'Bills & Utilities']);

        // Step 5: Duplicate prevention keys
        expect(candidate.reference).toBe('FT2610123456');
        const fingerprint = generateSmsFingerprint(candidate);
        expect(fingerprint).toHaveLength(64);

        // Step 6: Prepared transaction record
        const preparedTransaction: Transaction = {
            id: 'tx_cbe_test_1',
            amount: candidate.ledgerAmount,
            type: candidate.type,
            categoryId: 'cat-utilities',
            walletId: walletOutcome.matchedWallet!.id,
            note: candidate.description + ` [Ref: ${candidate.reference}]`,
            date: candidate.dateTime || new Date().toISOString(),
            status: 'CLEARED',
            currentBalance: candidate.currentBalance,
            source: 'sms',
            smsReference: candidate.reference,
            smsFingerprint: fingerprint,
            createdAt: '2026-10-22T12:00:00Z',
        };

        expect(preparedTransaction.amount).toBe(1312);
        expect(preparedTransaction.type).toBe('DEBIT');
        expect(preparedTransaction.source).toBe('sms');
        expect(preparedTransaction.smsReference).toBe('FT2610123456');
    });

    it('requires manual wallet resolution when provider matches multiple wallets without account suffix', () => {
        // CBE SMS with masked account that does NOT have matching last 4
        const sms =
            'Dear Customer, You have successfully transferred ETB300.00 from account 1000****7777 to account 1000****8888 (RECIPIENT). ' +
            'Service charge of ETB 0.50 and VAT(15%) of ETB0.08 and Disaster Recovery(5%) of 0.03 with total of ETB300.61. ' +
            'Your current balance is ETB4,000.00. Thanks for Banking with CBE.';

        const parseResult = parseSms(sms);
        expect(parseResult.status).toBe('parsed');
        if (parseResult.status !== 'parsed') return;

        // User has two CBE wallets ('w-cbe-primary' ending in 1234, and 'w-cbe-savings' ending in 9999).
        // Since 7777 doesn't match either, it must NOT silently guess.
        const walletOutcome = matchWalletForCandidate(parseResult.candidate, mockWallets);
        expect(walletOutcome.confidence).toBe('ambiguous');
        expect(walletOutcome.matchedWallet).toBeNull();
        expect(walletOutcome.candidateWallets.map((w) => w.id)).toEqual(['w-cbe-primary', 'w-cbe-savings']);
    });

    it('handles messages lacking a date by warning and requiring user confirmation', () => {
        const smsWithoutDate =
            'Dear Customer, A debit transaction of ETB 500.0 has occurred on your account 1000****1234. ' +
            'with total of ETB500.00. Your current balance is ETB10,000.00. Thanks for Banking with CBE.';

        const parseResult = parseSms(smsWithoutDate);
        expect(parseResult.status).toBe('parsed');
        if (parseResult.status !== 'parsed') return;

        expect(parseResult.candidate.dateTime).toBeUndefined();
        expect(parseResult.candidate.warnings.some((w) => w.includes('date'))).toBe(true);
    });

    it('rejects inconsistent fee arithmetic and returns an informative ambiguous error', () => {
        const corruptedSms =
            'Dear Customer, A debit transaction of ETB 1000.0 has occurred on your account 1000****1234. ' +
            'Service charge of ETB 10.00 and VAT(15%) of ETB1.50 with total of ETB1500.00. ' +
            'Thanks for Banking with CBE.';

        const parseResult = parseSms(corruptedSms);
        expect(parseResult.status).toBe('ambiguous');
        if (parseResult.status === 'ambiguous') {
            expect(parseResult.reason).toContain('mismatch');
        }
    });

    it('verifies Telebirr derived fees (1000 + 5.22 + 0.78 = 1006) and dual transaction references', () => {
        const telebirrSms =
            'Dear Customer, You have transferred ETB 1,000.00 successfully from your telebirr account 09****4321 ' +
            'to Commercial Bank of Ethiopia account number 1000****5678 on 21/10/2026 13:28:24. ' +
            'Your telebirr transaction number is RA26102199 and your bank transaction number is FT88776655. ' +
            'The service fee is ETB 5.22 and 15% VAT on the service fee is ETB 0.78. Your current balance is ETB 383.83. ' +
            'Thank you for using telebirr. Ethio telecom.';

        const parseResult = parseSms(telebirrSms);
        expect(parseResult.status).toBe('parsed');
        if (parseResult.status !== 'parsed') return;

        const candidate = parseResult.candidate;
        expect(candidate.providerId).toBe('telebirr');
        expect(candidate.ledgerAmount).toBe(1006);
        expect(candidate.isLedgerAmountDerived).toBe(true);
        expect(candidate.reference).toBe('RA26102199');
        expect(candidate.secondaryReference).toBe('FT88776655');

        const walletOutcome = matchWalletForCandidate(candidate, mockWallets);
        expect(walletOutcome.confidence).toBe('exact_account');
        expect(walletOutcome.matchedWallet?.id).toBe('w-telebirr');
    });

    it('ensures fingerprint collision resistance across different timestamps or amounts', () => {
        const baseCandidate = {
            providerId: 'dashen' as const,
            type: 'CREDIT' as const,
            principalAmount: 500,
            ledgerAmount: 500,
            isLedgerAmountDerived: false,
            currency: 'ETB' as const,
            accountLast4: '5678',
            dateTime: '2026-10-19T12:00:00+03:00',
            counterparty: 'ABEBE',
            description: 'Dashen Deposit',
            rawSms: '',
            warnings: [],
        };

        const fp1 = generateSmsFingerprint(baseCandidate);
        const fp2 = generateSmsFingerprint({ ...baseCandidate, dateTime: '2026-10-19T12:00:01+03:00' });
        const fp3 = generateSmsFingerprint({ ...baseCandidate, ledgerAmount: 501 });

        expect(fp1).not.toBe(fp2);
        expect(fp1).not.toBe(fp3);
        // Same inputs produce identical hash
        expect(generateSmsFingerprint(baseCandidate)).toBe(fp1);
    });
});
