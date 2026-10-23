// sms/__tests__/awash.test.ts
// Unit tests for Awash Bank SMS transaction parsing.
// All tests use strictly synthetic, anonymized fixture strings.

import { describe, expect, it } from '@jest/globals';
import { parseAwashSms } from '../providers/awash';
import { parseSms, detectProvider } from '../index';

describe('Awash Bank SMS Parsing', () => {
    // Synthetic sample matching real Awash interbank credit structure
    const syntheticAwashCreditSms =
        'Dear Customer, your Account 1000****1234 has been Credited with ETB 2000.00 on 2026-10-14 08:32:28 by ABEBE BIKILA via IPS DASHEN BANK. ' +
        'Your balance now is ETB 34720.30. For any complaint or enquiry, please call 8980. ' +
        'Subscribe to our official Telegram channel: https://t.me/example for more information. ' +
        'Please give us your feedback using the following link: https://example.com/survey. Awash Bank.';

    describe('Pattern 1: Verified Incoming Credit (CREDIT)', () => {
        it('parses incoming credit with correct amount, accountLast4, timestamp, balance, and counterparty', () => {
            const result = parseAwashSms(syntheticAwashCreditSms);

            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;

            const { candidate } = result;
            expect(candidate.providerId).toBe('awash');
            expect(candidate.type).toBe('CREDIT');
            expect(candidate.principalAmount).toBe(2000.0);
            expect(candidate.ledgerAmount).toBe(2000.0);
            expect(candidate.isLedgerAmountDerived).toBe(false);
            expect(candidate.currency).toBe('ETB');
            expect(candidate.accountIdentifier).toBe('1000****1234');
            expect(candidate.accountLast4).toBe('1234');
            expect(candidate.dateTime).toBe('2026-10-14T08:32:28+03:00');
            expect(candidate.currentBalance).toBe(34720.3);
            expect(candidate.counterparty).toBe('ABEBE BIKILA via IPS DASHEN BANK');
            expect(candidate.reference).toBeUndefined();

            // Warnings should indicate that reference was absent
            expect(candidate.warnings).toContain(
                'No transaction reference was provided in the Awash message. Deduplication relies on account, timestamp, and amount.'
            );
        });

        it('ignores complaint numbers, Telegram links, and feedback survey URLs', () => {
            const result = parseAwashSms(syntheticAwashCreditSms);

            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;

            // Telegram or feedback URLs must NOT become the reference
            expect(result.candidate.reference).toBeUndefined();
        });

        it('supports footer variation with "Awash International Bank"', () => {
            const variant = syntheticAwashCreditSms.replace('Awash Bank.', 'Awash International Bank.');
            const detected = detectProvider(variant);
            expect(detected).toBe('awash');

            const result = parseAwashSms(variant);
            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;
            expect(result.candidate.providerId).toBe('awash');
            expect(result.candidate.ledgerAmount).toBe(2000.0);
        });

        it('handles malformed date by warning user to confirm date manually', () => {
            const badDateSms =
                'Dear Customer, your Account 1000****1234 has been Credited with ETB 2000.00 on INVALID_DATE by ABEBE BIKILA. Your balance now is ETB 34720.30. Awash Bank.';
            const result = parseAwashSms(badDateSms);
            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;
            expect(result.candidate.dateTime).toBeUndefined();
            expect(result.candidate.warnings.some((w) => w.includes('date'))).toBe(true);
        });
    });

    describe('Critical Provider Detection Precedence', () => {
        it('routes Awash message to Awash Bank even when the body explicitly mentions "via IPS DASHEN BANK"', () => {
            // Regression test: Awash institutional signature must take precedence over the originating IPS channel
            const detected = detectProvider(syntheticAwashCreditSms);
            expect(detected).toBe('awash');

            const parseResult = parseSms(syntheticAwashCreditSms);
            expect(parseResult.status).toBe('parsed');
            if (parseResult.status !== 'parsed') return;
            expect(parseResult.candidate.providerId).toBe('awash');
        });

        it('does not create a Dashen parser result for the Awash example', () => {
            const parseResult = parseSms(syntheticAwashCreditSms);
            expect(parseResult.status).toBe('parsed');
            if (parseResult.status !== 'parsed') return;
            expect(parseResult.candidate.providerId).not.toBe('dashen');
        });
    });

    describe('Failure and Edge Cases', () => {
        it('returns malformed when amount is missing or invalid', () => {
            const badAmountSms =
                'Dear Customer, your Account 1000****1234 has been Credited with ETB INVALID on 2026-10-14 08:32:28 by JOHN. Awash Bank.';
            const result = parseAwashSms(badAmountSms);
            expect(result.status).toBe('malformed');
        });

        it('returns malformed for unsupported debit messages rather than guessing', () => {
            const unsupportedDebitSms =
                'Dear Customer, your Account 1000****1234 has been Debited with ETB 500.00 on 2026-10-14 08:32:28. Awash Bank.';
            const result = parseAwashSms(unsupportedDebitSms);
            expect(result.status).toBe('malformed');
            if (result.status === 'malformed') {
                expect(result.reason).toContain('debit messages are not yet officially supported');
            }
        });

        it('returns malformed for completely unrecognized message', () => {
            const randomAwashSms = 'Awash Bank: Visit your nearest branch for loan advisory services.';
            const result = parseAwashSms(randomAwashSms);
            expect(result.status).toBe('malformed');
        });
    });
});
