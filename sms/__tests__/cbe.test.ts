// sms/__tests__/cbe.test.ts
// Unit tests for Commercial Bank of Ethiopia (CBE) SMS parser using synthetic fixtures.

import { describe, expect, it } from '@jest/globals';
import { parseSms } from '../index';

describe('CBE SMS Parser', () => {
    it('parses CBE debit transaction with full fee breakdown (Section 6.1)', () => {
        const sms =
            'Dear Customer, A debit transaction of ETB 1300.0 has occurred on your account 1000****1234. ' +
            'Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB1312.00. ' +
            'Your current balance is ETB840,060.64. Thanks for Banking with CBE. https://apps.cbe.com.et:100/?id=FT26109988 for feedback: https://cbe.et/fb';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        const { candidate } = result;
        expect(candidate.providerId).toBe('cbe');
        expect(candidate.type).toBe('DEBIT');
        expect(candidate.principalAmount).toBe(1300);
        expect(candidate.ledgerAmount).toBe(1312);
        expect(candidate.isLedgerAmountDerived).toBe(false);
        expect(candidate.accountIdentifier).toBe('1000****1234');
        expect(candidate.accountLast4).toBe('1234');
        expect(candidate.currentBalance).toBe(840060.64);
        expect(candidate.reference).toBe('FT26109988');

        // Check fee breakdown
        expect(candidate.fees).toBeDefined();
        expect(candidate.fees?.serviceCharge).toBe(10);
        expect(candidate.fees?.vat).toBe(1.5);
        expect(candidate.fees?.disasterFund).toBe(0.5);
        expect(candidate.fees?.totalFees).toBe(12);

        // Date was not in message -> warning present
        expect(candidate.dateTime).toBeUndefined();
        expect(candidate.warnings.length).toBeGreaterThan(0);
    });

    it('parses CBE successful transfer with fractional fees and recipient (Section 6.2)', () => {
        const sms =
            'Dear Customer, You have successfully transferred ETB300.00 from account 1000****1111 to account 1000****2222 (ALMAZ AYANA). ' +
            'Service charge of ETB 0.50 and VAT(15%) of ETB0.08 and Disaster Recovery(5%) of 0.03 with total of ETB300.61. ' +
            'Your current balance is ETB5,432.10. Thanks for Banking with CBE. https://apps.cbe.com.et/Receipt/CBE998877';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        const { candidate } = result;
        expect(candidate.providerId).toBe('cbe');
        expect(candidate.type).toBe('DEBIT');
        expect(candidate.principalAmount).toBe(300);
        expect(candidate.ledgerAmount).toBe(300.61);
        expect(candidate.accountIdentifier).toBe('1000****1111');
        expect(candidate.accountLast4).toBe('1111');
        expect(candidate.counterparty).toBe('ALMAZ AYANA (Acct 1000****2222)');
        expect(candidate.currentBalance).toBe(5432.1);
        expect(candidate.reference).toBe('CBE998877');

        expect(candidate.fees?.serviceCharge).toBe(0.5);
        expect(candidate.fees?.vat).toBe(0.08);
        expect(candidate.fees?.disasterFund).toBe(0.03);
        expect(candidate.fees?.totalFees).toBe(0.61);
    });

    it('derives ledger amount correctly when explicit fees are present without a stated total', () => {
        const sms =
            'Dear Customer, A debit transaction of ETB 500.00 has occurred on your account 1000****1234. ' +
            'Service charge of ETB 2.00 and VAT(15%) of ETB0.30. Your current balance is ETB 1,000.00. Thanks for Banking with CBE.';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        expect(result.candidate.principalAmount).toBe(500);
        expect(result.candidate.ledgerAmount).toBe(502.3);
        expect(result.candidate.isLedgerAmountDerived).toBe(true);
        expect(result.candidate.fees?.totalFees).toBe(2.3);
    });

    it('returns ambiguous when stated total materially conflicts with principal + fees', () => {
        const sms =
            'Dear Customer, A debit transaction of ETB 1000.00 has occurred on your account 1000****1234. ' +
            'Service charge of ETB 10.00 and VAT(15%) of ETB1.50 with total of ETB1500.00. Thanks for Banking with CBE.';

        const result = parseSms(sms);
        expect(result.status).toBe('ambiguous');
        if (result.status === 'ambiguous') {
            expect(result.reason).toContain('mismatch');
        }
    });

    it('parses CBE incoming credit / deposit', () => {
        const sms =
            'Account 1000****9999 has been credited with ETB 4,500.00. Balance is ETB 14,500.00. id=FT26107777 Thanks for Banking with CBE.';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        expect(result.candidate.type).toBe('CREDIT');
        expect(result.candidate.principalAmount).toBe(4500);
        expect(result.candidate.ledgerAmount).toBe(4500);
        expect(result.candidate.accountIdentifier).toBe('1000****9999');
        expect(result.candidate.accountLast4).toBe('9999');
        expect(result.candidate.reference).toBe('FT26107777');
        expect(result.candidate.currentBalance).toBe(14500);
    });

    it('rejects CBE OTP messages as non-transaction', () => {
        const otpSms = 'Dear Customer, your CBE Mobile Banking OTP is 482910. Do not share this code with anyone.';
        const result = parseSms(otpSms);
        expect(result.status).toBe('non_transaction');
        if (result.status === 'non_transaction') {
            expect(result.messageType).toBe('otp');
        }
    });

    it('returns malformed when amount is missing or invalid', () => {
        const invalidSms = 'Dear Customer, A debit transaction of ETB abc has occurred on your account 1000****1234. Thanks for Banking with CBE.';
        const result = parseSms(invalidSms);
        expect(result.status).toBe('malformed');
    });
});
