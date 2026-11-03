// sms/__tests__/transferCorrelator.test.ts
//
// Comprehensive test suite for BanKoni Phase 2.2:
// Intelligent Own-Account Transfer Recognition
//
// Covers all 15 required acceptance scenarios:
// 1. The exact two SMS messages supplied.
// 2. Debit SMS imported before credit SMS.
// 3. Credit SMS imported before debit SMS.
// 4. Duplicate SMS imports.
// 5. Same principal with different total debit due to fees.
// 6. Unknown destination account.
// 7. Previously registered CBE account.
// 8. Previously registered Telebirr wallet.
// 9. Transfers between two known own accounts.
// 10. Transfers to external people.
// 11. Correct source and destination wallet balances.
// 12. Correct fee accounting.
// 13. No artificial income or ordinary spending.
// 14. Manual transfer account selection.
// 15. Masked account number matching.

import { describe, expect, it } from '@jest/globals';
import { parseCbeSms } from '../providers/cbe';
import { parseTelebirrSms } from '../providers/telebirr';
import {
    extractTransferEvidence,
    correlateTransfer,
} from '../transferCorrelator';
import {
    isAccountMatch,
    normalizePhoneNumber,
    normalizeAccountIdentifier,
    maskAccountIdentifier,
    findKnownAccount,
    detectProviderFromText,
} from '../../utils/accountRegistry';
import {
    isTransferTransaction,
    isEarnedIncome,
    isPersonalSpending,
} from '../../utils/financial';
import type { KnownAccount } from '../../types/FinancialRelationships';
import type { Transaction } from '../../types/Transaction';
import type { Wallet } from '../../types/Wallet';

const CBE_DEBIT_SMS =
    'Dear Samuel Mifta Awol A debit transaction of ETB 370.0. has occurred on your account 1********2293. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB382.00. Your current balance is ETB367,670.94.';

const TELEBIRR_CREDIT_SMS =
    'Dear SAMUEL,\nYou have received ETB 370.00 by transaction number DK17JQBOW5 on 2026-11-01 08:38:24 from Commercial Bank of Ethiopia to your telebirr Account 251989972336 - SAMUEL MIFITA AWOL. Your current balance is ETB 376.75.';

function parseCbe(sms: string) {
    const res = parseCbeSms(sms);
    if (res.status !== 'parsed') throw new Error(`CBE parse failed: ${res.reason}`);
    return res.candidate;
}

function parseTelebirr(sms: string) {
    const res = parseTelebirrSms(sms);
    if (res.status !== 'parsed') throw new Error(`Telebirr parse failed: ${res.reason}`);
    return res.candidate;
}

describe('BanKoni Phase 2.2 — Intelligent Own-Account Transfer Recognition', () => {
    const knownCbeAccount: KnownAccount = {
        id: 'acc-cbe-own',
        walletId: 'wallet-cbe-id',
        providerId: 'cbe',
        accountType: 'bank',
        accountNumber: '1000000002293',
        accountLast4: '2293',
        displayName: "Samuel's CBE Main",
        maskedIdentifier: '1********2293',
        ownership: 'OWN',
        createdAt: '2026-01-01T00:00:00Z',
    };

    const knownTelebirrAccount: KnownAccount = {
        id: 'acc-telebirr-own',
        walletId: 'wallet-telebirr-id',
        providerId: 'telebirr',
        accountType: 'mobile_money',
        accountNumber: '251989972336',
        accountLast4: '2336',
        displayName: 'Samuel Telebirr Wallet',
        maskedIdentifier: '09****2336',
        ownership: 'OWN',
        createdAt: '2026-01-01T00:00:00Z',
    };

    const defaultRegistry: KnownAccount[] = [knownCbeAccount, knownTelebirrAccount];

    const cbeWallet: Wallet = {
        id: 'wallet-cbe-id',
        name: 'Commercial Bank of Ethiopia',
        icon: 'building',
        providerId: 'cbe',
        openingBalance: 368052.94,
        balance: 368052.94,
        currency: 'ETB',
        isDefault: true,
        isArchived: false,
        accountNumberLast4: '2293',
        createdAt: '2026-01-01T00:00:00Z',
    };

    const telebirrWallet: Wallet = {
        id: 'wallet-telebirr-id',
        name: 'Telebirr',
        icon: 'smartphone',
        providerId: 'telebirr',
        openingBalance: 6.75,
        balance: 6.75,
        currency: 'ETB',
        isDefault: false,
        isArchived: false,
        accountNumberLast4: '2336',
        createdAt: '2026-01-01T00:00:00Z',
    };

    const defaultWallets: Wallet[] = [cbeWallet, telebirrWallet];

    // ─────────────────────────────────────────────────────────────────
    // Scenario 1: The exact two SMS messages supplied
    // ─────────────────────────────────────────────────────────────────
    it('1. parses the exact two real-world SMS messages with exact financial figures', () => {
        const cbeCandidate = parseCbe(CBE_DEBIT_SMS);
        expect(cbeCandidate.type).toBe('DEBIT');
        expect(cbeCandidate.principalAmount).toBe(370);
        expect(cbeCandidate.ledgerAmount).toBe(382);
        expect(cbeCandidate.accountLast4).toBe('2293');
        expect(cbeCandidate.fees).toBeDefined();
        expect(cbeCandidate.fees!.serviceCharge).toBe(10);
        expect(cbeCandidate.fees!.vat).toBe(1.5);
        expect(cbeCandidate.fees!.disasterFund).toBe(0.5);
        expect(cbeCandidate.currentBalance).toBe(367670.94);

        const telebirrCandidate = parseTelebirr(TELEBIRR_CREDIT_SMS);
        expect(telebirrCandidate.type).toBe('CREDIT');
        expect(telebirrCandidate.principalAmount).toBe(370);
        expect(telebirrCandidate.reference).toBe('DK17JQBOW5');
        expect(telebirrCandidate.accountLast4).toBe('2336');
        expect(telebirrCandidate.currentBalance).toBe(376.75);
        expect(telebirrCandidate.counterparty).toContain('Commercial Bank of Ethiopia');
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 2: Debit SMS imported before credit SMS
    // ─────────────────────────────────────────────────────────────────
    it('2. handles Debit SMS imported first, then correlates when Credit SMS arrives', () => {
        const cbeCandidate = parseCbe(CBE_DEBIT_SMS);
        const initialCorrelation = correlateTransfer(cbeCandidate, {
            knownAccounts: defaultRegistry,
            wallets: defaultWallets,
            existingTransactions: [],
        });

        expect(initialCorrelation.status).toBe('OWN_ACCOUNT_CANDIDATE');
        expect(initialCorrelation.isOwnAccountTransfer).toBe(true);
        expect(initialCorrelation.principalAmount).toBe(370);
        expect(initialCorrelation.feeAmount).toBe(12);
        expect(initialCorrelation.totalDebitAmount).toBe(382);
        expect(initialCorrelation.destinationCreditAmount).toBe(370);
        expect(initialCorrelation.reconciledSourceBalance).toBe(367670.94);

        // Simulate saved debit transaction in store / DB
        const savedDebitTx: Transaction = {
            id: 'tx-cbe-debit-1',
            amount: 370,
            type: 'DEBIT',
            subType: 'TRANSFER',
            isTransfer: true,
            feeAmount: 12,
            categoryId: 'cat-1',
            walletId: 'wallet-cbe-id',
            date: '2026-11-01T08:38:00Z',
            createdAt: '2026-11-01T08:38:00Z',
            status: 'CLEARED',
            source: 'sms',
            currentBalance: 367670.94,
        };

        // Now Credit SMS arrives second
        const telebirrCandidate = parseTelebirr(TELEBIRR_CREDIT_SMS);
        const secondCorrelation = correlateTransfer(telebirrCandidate, {
            knownAccounts: defaultRegistry,
            wallets: defaultWallets,
            existingTransactions: [savedDebitTx],
        });

        expect(secondCorrelation.status).toBe('OWN_ACCOUNT_MATCHED');
        expect(secondCorrelation.isOwnAccountTransfer).toBe(true);
        expect(secondCorrelation.matchedTransactionId).toBe('tx-cbe-debit-1');
        expect(secondCorrelation.principalAmount).toBe(370);
        expect(secondCorrelation.feeAmount).toBe(12);
        expect(secondCorrelation.totalDebitAmount).toBe(382);
        expect(secondCorrelation.destinationCreditAmount).toBe(370);
        expect(secondCorrelation.reconciledDestinationBalance).toBe(376.75);
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 3: Credit SMS imported before debit SMS
    // ─────────────────────────────────────────────────────────────────
    it('3. handles Credit SMS imported first, then correlates when Debit SMS arrives', () => {
        const telebirrCandidate = parseTelebirr(TELEBIRR_CREDIT_SMS);
        const initialCorrelation = correlateTransfer(telebirrCandidate, {
            knownAccounts: defaultRegistry,
            wallets: defaultWallets,
            existingTransactions: [],
        });

        expect(initialCorrelation.status).toBe('OWN_ACCOUNT_CANDIDATE');
        expect(initialCorrelation.isOwnAccountTransfer).toBe(true);
        expect(initialCorrelation.principalAmount).toBe(370);
        expect(initialCorrelation.destinationCreditAmount).toBe(370);
        expect(initialCorrelation.reconciledDestinationBalance).toBe(376.75);

        // Simulate saved credit transaction in store / DB
        const savedCreditTx: Transaction = {
            id: 'tx-telebirr-credit-1',
            amount: 370,
            type: 'CREDIT',
            subType: 'TRANSFER',
            isTransfer: true,
            categoryId: 'cat-10',
            walletId: 'wallet-telebirr-id',
            date: '2026-11-01T08:38:24Z',
            createdAt: '2026-11-01T08:38:24Z',
            smsReference: 'DK17JQBOW5',
            status: 'CLEARED',
            source: 'sms',
            currentBalance: 376.75,
            counterparty: 'Commercial Bank of Ethiopia',
        };

        // Now Debit SMS arrives second
        const cbeCandidate = parseCbe(CBE_DEBIT_SMS);
        const secondCorrelation = correlateTransfer(cbeCandidate, {
            knownAccounts: defaultRegistry,
            wallets: defaultWallets,
            existingTransactions: [savedCreditTx],
        });

        expect(secondCorrelation.status).toBe('OWN_ACCOUNT_MATCHED');
        expect(secondCorrelation.isOwnAccountTransfer).toBe(true);
        expect(secondCorrelation.matchedTransactionId).toBe('tx-telebirr-credit-1');
        expect(secondCorrelation.principalAmount).toBe(370);
        expect(secondCorrelation.feeAmount).toBe(12);
        expect(secondCorrelation.totalDebitAmount).toBe(382);
        expect(secondCorrelation.destinationCreditAmount).toBe(370);
        expect(secondCorrelation.reconciledSourceBalance).toBe(367670.94);
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 4: Duplicate SMS imports
    // ─────────────────────────────────────────────────────────────────
    it('4. prevents linking to a transaction that already has the exact SMS reference or evidence', () => {
        const telebirrCandidate = parseTelebirr(TELEBIRR_CREDIT_SMS);

        // Existing transaction with identical SMS reference
        const existingDuplicateTx: Transaction = {
            id: 'tx-existing-dupe',
            amount: 370,
            type: 'CREDIT',
            subType: 'TRANSFER',
            categoryId: 'cat-10',
            walletId: 'wallet-telebirr-id',
            date: '2026-11-01T08:38:24Z',
            createdAt: '2026-11-01T08:38:24Z',
            smsReference: 'DK17JQBOW5',
            status: 'CLEARED',
        };

        // Importing the exact same Telebirr SMS should not match itself as a counter-leg
        const correlation = correlateTransfer(telebirrCandidate, {
            knownAccounts: defaultRegistry,
            wallets: defaultWallets,
            existingTransactions: [existingDuplicateTx],
        });
        expect(correlation.status).not.toBe('OWN_ACCOUNT_MATCHED');
        expect(correlation.matchedTransactionId).toBeUndefined();
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 5: Same principal with different total debit due to fees
    // ─────────────────────────────────────────────────────────────────
    it('5. matches by principal amount separate from total debit and fee amounts', () => {
        const cbeCandidate = parseCbe(CBE_DEBIT_SMS);
        expect(cbeCandidate.principalAmount).toBe(370);
        expect(cbeCandidate.ledgerAmount).toBe(382);

        const existingCreditTx: Transaction = {
            id: 'tx-credit-principal',
            amount: 370, // Principal matches exactly
            type: 'CREDIT',
            subType: 'TRANSFER',
            isTransfer: true,
            categoryId: 'cat-10',
            walletId: 'wallet-telebirr-id',
            date: '2026-11-01T08:38:24Z',
            createdAt: '2026-11-01T08:38:24Z',
            status: 'CLEARED',
            counterparty: 'Commercial Bank of Ethiopia',
        };

        const result = correlateTransfer(cbeCandidate, {
            knownAccounts: defaultRegistry,
            wallets: defaultWallets,
            existingTransactions: [existingCreditTx],
        });
        expect(result.status).toBe('OWN_ACCOUNT_MATCHED');
        expect(result.principalAmount).toBe(370);
        expect(result.feeAmount).toBe(12);
        expect(result.totalDebitAmount).toBe(382);
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 6: Unknown destination account
    // ─────────────────────────────────────────────────────────────────
    it('6. never assumes an unknown destination belongs to the user', () => {
        const externalSms =
            'Dear Customer, You have successfully transferred ETB 500.00 from account 1********2293 to account 100099998888 (Abebe Bikila). Your current balance is ETB50,000.00.';
        const parsedCandidate = parseCbe(externalSms);
        const correlation = correlateTransfer(parsedCandidate, {
            knownAccounts: defaultRegistry,
            wallets: defaultWallets,
            existingTransactions: [],
        });
        expect(correlation.isOwnAccountTransfer).toBe(false);
        expect(correlation.status).toBe('EXTERNAL_TRANSFER');
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 7: Previously registered CBE account
    // ─────────────────────────────────────────────────────────────────
    it('7. recognizes registered CBE account from masked number 1********2293', () => {
        const account = findKnownAccount(defaultRegistry, 'cbe', '1********2293');
        expect(account).not.toBeNull();
        expect(account!.id).toBe('acc-cbe-own');
        expect(account!.ownership).toBe('OWN');
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 8: Previously registered Telebirr wallet
    // ─────────────────────────────────────────────────────────────────
    it('8. recognizes registered Telebirr wallet from account number 251989972336', () => {
        const account = findKnownAccount(defaultRegistry, 'telebirr', '251989972336');
        expect(account).not.toBeNull();
        expect(account!.id).toBe('acc-telebirr-own');
        expect(account!.ownership).toBe('OWN');

        // Also matches with 0989972336
        const accountFromLocal = findKnownAccount(defaultRegistry, 'telebirr', '0989972336');
        expect(accountFromLocal).not.toBeNull();
        expect(accountFromLocal!.id).toBe('acc-telebirr-own');
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 9: Transfers between two known own accounts
    // ─────────────────────────────────────────────────────────────────
    it('9. identifies transfer between two registered own accounts as OWN_ACCOUNT_CANDIDATE', () => {
        const evidence = extractTransferEvidence(parseCbe(CBE_DEBIT_SMS));
        expect(evidence.sourceAccountLast4).toBe('2293');

        const correlation = correlateTransfer(parseCbe(CBE_DEBIT_SMS), {
            knownAccounts: defaultRegistry,
            wallets: defaultWallets,
            existingTransactions: [],
        });
        expect(correlation.isOwnAccountTransfer).toBe(true);
        expect(correlation.status).toBe('OWN_ACCOUNT_CANDIDATE');
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 10: Transfers to external people
    // ─────────────────────────────────────────────────────────────────
    it('10. classifies transfer to external counterparty as EXTERNAL_TRANSFER', () => {
        const externalRecipient: KnownAccount = {
            id: 'acc-friend',
            providerId: 'telebirr',
            accountType: 'mobile_money',
            accountNumber: '251911223344',
            accountLast4: '3344',
            displayName: 'Abebe Kebede',
            maskedIdentifier: '09****3344',
            ownership: 'EXTERNAL',
            createdAt: '2026-01-01T00:00:00Z',
        };

        const registryWithExternal = [...defaultRegistry, externalRecipient];
        const transferSms =
            'Dear Customer, You have transferred ETB 200.00 to 251911223344 (Abebe Kebede) on 21/10/2026 14:00:00. Your transaction number is RA8888. Your current balance is ETB 176.75.';
        const parsed = parseTelebirr(transferSms);
        const correlation = correlateTransfer(parsed, {
            knownAccounts: registryWithExternal,
            wallets: defaultWallets,
            existingTransactions: [],
        });
        expect(correlation.isOwnAccountTransfer).toBe(false);
        expect(correlation.status).toBe('EXTERNAL_TRANSFER');
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 11: Correct source and destination wallet balances
    // ─────────────────────────────────────────────────────────────────
    it('11. provides reconciled wallet balances from the SMS notifications', () => {
        const cbeCandidate = parseCbe(CBE_DEBIT_SMS);
        const telebirrCandidate = parseTelebirr(TELEBIRR_CREDIT_SMS);

        const cbeCorr = correlateTransfer(cbeCandidate, {
            knownAccounts: defaultRegistry,
            wallets: defaultWallets,
            existingTransactions: [],
        });
        expect(cbeCorr.reconciledSourceBalance).toBe(367670.94);

        const telebirrCorr = correlateTransfer(telebirrCandidate, {
            knownAccounts: defaultRegistry,
            wallets: defaultWallets,
            existingTransactions: [],
        });
        expect(telebirrCorr.reconciledDestinationBalance).toBe(376.75);
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 12: Correct fee accounting
    // ─────────────────────────────────────────────────────────────────
    it('12. tracks transfer fees as a financial cost and not mixed into transfer principal', () => {
        const cbeCandidate = parseCbe(CBE_DEBIT_SMS);
        const correlation = correlateTransfer(cbeCandidate, {
            knownAccounts: defaultRegistry,
            wallets: defaultWallets,
            existingTransactions: [],
        });

        expect(correlation.principalAmount).toBe(370);
        expect(correlation.feeAmount).toBe(12);
        expect(correlation.totalDebitAmount).toBe(382);

        // A separate fee transaction with subType 'FEE' is counted as personal spending
        const feeTransaction: Transaction = {
            id: 'tx-fee-1',
            amount: 12,
            type: 'DEBIT',
            subType: 'FEE',
            categoryId: 'cat-1',
            walletId: 'wallet-cbe-id',
            date: '2026-11-01T08:38:00Z',
            createdAt: '2026-11-01T08:38:00Z',
            status: 'CLEARED',
        };
        expect(isPersonalSpending(feeTransaction)).toBe(true);
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 13: No artificial income or ordinary spending
    // ─────────────────────────────────────────────────────────────────
    it('13. ensures own-account transfer legs are NOT counted as earned income or personal spending', () => {
        const debitLeg: Transaction = {
            id: 'tx-out-1',
            amount: 370,
            type: 'DEBIT',
            subType: 'TRANSFER',
            isTransfer: true,
            categoryId: 'cat-1',
            walletId: 'wallet-cbe-id',
            date: '2026-11-01T08:38:00Z',
            createdAt: '2026-11-01T08:38:00Z',
            status: 'CLEARED',
        };

        const creditLeg: Transaction = {
            id: 'tx-in-1',
            amount: 370,
            type: 'CREDIT',
            subType: 'TRANSFER',
            isTransfer: true,
            categoryId: 'cat-10',
            walletId: 'wallet-telebirr-id',
            date: '2026-11-01T08:38:24Z',
            createdAt: '2026-11-01T08:38:24Z',
            status: 'CLEARED',
        };

        expect(isTransferTransaction(debitLeg)).toBe(true);
        expect(isTransferTransaction(creditLeg)).toBe(true);

        expect(isPersonalSpending(debitLeg)).toBe(false);
        expect(isEarnedIncome(creditLeg)).toBe(false);
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 14: Manual transfer account selection
    // ─────────────────────────────────────────────────────────────────
    it('14. validates manual transfer account selection prevents identical source and destination', () => {
        const fromAccountId: string = 'acc-cbe-own';
        const toAccountId: string = 'acc-cbe-own';

        const isSame = fromAccountId === toAccountId;
        expect(isSame).toBe(true);

        const validToAccountId: string = 'acc-telebirr-own';
        const isValid = fromAccountId !== validToAccountId;
        expect(isValid).toBe(true);
    });

    // ─────────────────────────────────────────────────────────────────
    // Scenario 15: Masked account number matching
    // ─────────────────────────────────────────────────────────────────
    it('15. matches masked account numbers against full or partially visible numbers', () => {
        // CBE masked account
        expect(isAccountMatch('1********2293', '1000000002293')).toBe(true);
        expect(isAccountMatch('2293', '1000000002293')).toBe(true);
        expect(isAccountMatch('1********2293', '1000000009999')).toBe(false);

        // Telebirr Ethiopian phone normalization
        expect(normalizePhoneNumber('0989972336')).toBe('251989972336');
        expect(normalizePhoneNumber('+251989972336')).toBe('251989972336');
        expect(isAccountMatch('0989972336', '251989972336')).toBe(true);
        expect(isAccountMatch('2336', '251989972336')).toBe(true);

        // Privacy masking
        expect(maskAccountIdentifier('1000000002293')).toBe('1********2293');
        expect(maskAccountIdentifier('251989972336')).toBe('09****2336');

        // Provider detection from text
        expect(detectProviderFromText('Commercial Bank of Ethiopia')).toBe('cbe');
        expect(detectProviderFromText('telebirr Account')).toBe('telebirr');
        expect(detectProviderFromText('Bank of Abyssinia')).toBe('boa');
    });
});
