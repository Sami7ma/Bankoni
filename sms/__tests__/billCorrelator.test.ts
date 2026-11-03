// sms/__tests__/billCorrelator.test.ts

import { describe, expect, it } from '@jest/globals';
import {
    classifyBillEvidence,
    correlateBillConfirmation,
} from '../billCorrelator';
import type { Transaction } from '../../types/Transaction';

describe('Bill Confirmation & Evidence Correlation Engine', () => {
    describe('classifyBillEvidence', () => {
        it('identifies Ethio Telecom bill receipt as biller-side confirmation evidence', () => {
            const sms = 'Dear customer, your payment of ETB 1,874.99 for service number 0115512345 has been received on 25/10/2026 14:30:15. Receipt no: REC-998811. Thank you for choosing Ethio telecom.';
            const result = classifyBillEvidence(sms);

            expect(result.type).toBe('biller_confirmation');
            expect(result.evidence).toBeDefined();
            expect(result.evidence?.billerName).toBe('Ethio telecom');
            expect(result.evidence?.amount).toBe(1874.99);
            expect(result.evidence?.accountNumber).toBe('0115512345');
            expect(result.evidence?.confirmationCode).toBe('REC-998811');
        });

        it('identifies Telebirr bill payment as financial debit evidence', () => {
            const sms = 'Dear Customer, You have paid ETB 1,874.99 for Ethio Telecom bill payment with account 0115512345 on 25/10/2026 14:30:00. Your transaction number is RA987654. Your current balance is ETB 500.00.';
            const result = classifyBillEvidence(sms);

            expect(result.type).toBe('financial_payment');
        });
    });

    describe('correlateBillConfirmation', () => {
        const existingDebitTx: Transaction = {
            id: 'tx-telebirr-bill',
            amount: 1874.99,
            type: 'DEBIT',
            categoryId: 'cat-11', // Utilities
            note: 'Ethio Telecom bill payment account 0115512345',
            counterparty: 'Ethio telecom',
            date: '2026-10-25T14:30:00+03:00',
            status: 'CLEARED',
            walletId: 'w-telebirr',
            smsReference: 'RA987654',
            createdAt: '2026-10-25T14:30:00Z',
        };

        it('correlates Telebirr debit and Ethio Telecom receipt into ONE movement without duplicate expense', () => {
            const evidence = {
                billerName: 'Ethio telecom',
                accountNumber: '0115512345',
                billReference: 'REC-998811',
                amount: 1874.99,
                rawMessage: 'Receipt no: REC-998811 for payment of ETB 1,874.99 for service number 0115512345',
            };

            const correlation = correlateBillConfirmation(evidence, [existingDebitTx]);

            expect(correlation.status).toBe('MATCHED');
            expect(correlation.matchedTransactionId).toBe('tx-telebirr-bill');
        });

        it('flags ambiguous match when there are multiple independent payments of the exact same amount', () => {
            const debit1: Transaction = {
                ...existingDebitTx,
                id: 'tx-1',
                note: 'Payment without account number',
            };
            const debit2: Transaction = {
                ...existingDebitTx,
                id: 'tx-2',
                note: 'Second payment without account number',
            };

            const evidence = {
                billerName: 'Ethio telecom',
                amount: 1874.99,
                rawMessage: 'Receipt for payment of ETB 1,874.99 received',
            };

            const correlation = correlateBillConfirmation(evidence, [debit1, debit2]);

            expect(correlation.status).toBe('AMBIGUOUS');
            expect(correlation.candidateTransactions).toHaveLength(2);
        });

        it('returns UNMATCHED if financial debit has not yet arrived', () => {
            const evidence = {
                billerName: 'Ethio telecom',
                accountNumber: '0115512345',
                amount: 1874.99,
                rawMessage: 'Receipt for payment of ETB 1,874.99',
            };

            const correlation = correlateBillConfirmation(evidence, []);

            expect(correlation.status).toBe('UNMATCHED');
            expect(correlation.matchedTransactionId).toBeUndefined();
        });
    });
});
