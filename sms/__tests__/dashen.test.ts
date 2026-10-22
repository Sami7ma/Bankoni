// sms/__tests__/dashen.test.ts
// Unit tests for Dashen Bank SMS parser using synthetic fixtures.

import { describe, expect, it } from '@jest/globals';
import { parseSms } from '../index';

describe('Dashen Bank SMS Parser', () => {
    it('parses Dashen incoming credit with counterparty and 12-hour PM time (Section 6.3)', () => {
        const sms =
            "Dear Customer, your account '1234****5678' is credited with ETB 230.00 from ABEBE BIKILA on 19/10/2026 at 12:22:25 PM. " +
            'Your current balance is ETB 4,772.38. Dashen Bank - Always one step ahead!';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        const { candidate } = result;
        expect(candidate.providerId).toBe('dashen');
        expect(candidate.type).toBe('CREDIT');
        expect(candidate.principalAmount).toBe(230);
        expect(candidate.ledgerAmount).toBe(230);
        expect(candidate.isLedgerAmountDerived).toBe(false);
        expect(candidate.accountIdentifier).toBe('1234****5678');
        expect(candidate.accountLast4).toBe('5678');
        expect(candidate.counterparty).toBe('ABEBE BIKILA');
        expect(candidate.currentBalance).toBe(4772.38);

        // Date check: 12:22:25 PM -> 12:22:25 EAT
        expect(candidate.dateTime).toBe('2026-10-19T12:22:25+03:00');
    });

    it('parses Dashen credit from Telebirr source', () => {
        const sms =
            "Dear Customer, your account '9876****4321' is credited with ETB 1,500.00 from Telebirr on 20/10/2026 at 09:15:00 AM. " +
            'Your current balance is ETB 8,200.00. Dashen Bank - Always one step ahead!';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        expect(result.candidate.providerId).toBe('dashen');
        expect(result.candidate.type).toBe('CREDIT');
        expect(result.candidate.principalAmount).toBe(1500);
        expect(result.candidate.counterparty).toBe('Telebirr');
        expect(result.candidate.dateTime).toBe('2026-10-20T09:15:00+03:00');
    });

    it('parses Dashen outgoing debit with no counterparty (Section 6.4)', () => {
        const sms =
            "Dear Customer, your account '1234****5678' is debited with ETB 1,000.00 on 15/10/2026 at 04:10:28 PM. " +
            'Your current balance is ETB 2,938.38. Dashen Bank - Always one step ahead!';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        const { candidate } = result;
        expect(candidate.providerId).toBe('dashen');
        expect(candidate.type).toBe('DEBIT');
        expect(candidate.principalAmount).toBe(1000);
        expect(candidate.ledgerAmount).toBe(1000);
        expect(candidate.accountIdentifier).toBe('1234****5678');
        expect(candidate.accountLast4).toBe('5678');
        expect(candidate.counterparty).toBeUndefined();
        expect(candidate.currentBalance).toBe(2938.38);

        // 04:10:28 PM -> 16:10:28
        expect(candidate.dateTime).toBe('2026-10-15T16:10:28+03:00');
    });

    it('rejects Dashen OTP as non-transaction', () => {
        const otpSms = 'Dear Customer, your Dashen Bank verification code is 912384. Do not share this code. Always one step ahead!';
        const result = parseSms(otpSms);
        expect(result.status).toBe('non_transaction');
        if (result.status === 'non_transaction') {
            expect(result.messageType).toBe('otp');
        }
    });

    it('returns malformed when debit amount is invalid', () => {
        const badSms = "Dear Customer, your account '1234' is debited with ETB -50.00 on 15/10/2026 at 04:10:28 PM. Dashen Bank - Always one step ahead!";
        const result = parseSms(badSms);
        expect(result.status).toBe('malformed');
    });
});
