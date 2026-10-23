// sms/__tests__/mpesa.test.ts
// Unit tests for M-PESA Ethiopia (Safaricom) SMS transaction parsing.
// All tests use strictly synthetic, anonymized fixture strings.

import { describe, expect, it } from '@jest/globals';
import { parseMpesaSms } from '../providers/mpesa';
import { parseSms } from '../index';
import { generateSmsFingerprint } from '../fingerprint';

describe('M-PESA Ethiopia SMS Parsing', () => {
    describe('Pattern 1: Incoming Transfer (CREDIT)', () => {
        // Synthetic sample representing CBE-B2C / P2P to M-PESA
        const syntheticIncomingSms =
            'Dear KASSAHUN, you have received 300.00 Birr from Commercial Bank Of Ethiopia-B2C - ABEBE BIKILA on 21/10/26 at 12:37 PM. ' +
            'Transaction number is MP2610TRX001. Your current M-PESA balance is 442.00 Birr. ' +
            'Use the below link to harmonize your M-PESA account with Fayda: https://example.com/fayda';

        it('parses incoming credit transfer with accurate direction, amount, and balance', () => {
            const result = parseMpesaSms(syntheticIncomingSms);

            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;

            const { candidate } = result;
            expect(candidate.providerId).toBe('mpesa');
            expect(candidate.type).toBe('CREDIT');
            expect(candidate.principalAmount).toBe(300.0);
            expect(candidate.ledgerAmount).toBe(300.0);
            expect(candidate.isLedgerAmountDerived).toBe(false);
            expect(candidate.currency).toBe('ETB');
            expect(candidate.reference).toBe('MP2610TRX001');
            expect(candidate.currentBalance).toBe(442.0);
            expect(candidate.counterparty).toBe('Commercial Bank Of Ethiopia-B2C - ABEBE BIKILA');
            expect(candidate.dateTime).toBe('2026-10-21T12:37:00+03:00');
            expect(candidate.warnings).toEqual([]);
        });

        it('correctly auto-detects M-PESA even when Commercial Bank of Ethiopia is named in the body', () => {
            const result = parseSms(syntheticIncomingSms);

            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;
            expect(result.candidate.providerId).toBe('mpesa');
        });
    });

    describe('Pattern 2: Safaricom Bundle Purchase (DEBIT)', () => {
        // Synthetic sample representing Safaricom bundle purchase
        const syntheticBundleSms =
            'Dear KASSAHUN, you have bought a Safaricom bundle of 160.00 Birr for 0712345678 on 21/10/26 at 12:37 PM. ' +
            'Transaction number MP2610BND002. Your current M-PESA balance is 282.00 Birr. ' +
            'Get your receipt here: https://example.com/receipt. Use the below link to harmonize your M-PESA account with Fayda: https://example.com/fayda';

        it('parses bundle purchase as DEBIT with correct amount, beneficiary, and balance', () => {
            const result = parseMpesaSms(syntheticBundleSms);

            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;

            const { candidate } = result;
            expect(candidate.providerId).toBe('mpesa');
            expect(candidate.type).toBe('DEBIT');
            expect(candidate.principalAmount).toBe(160.0);
            expect(candidate.ledgerAmount).toBe(160.0);
            expect(candidate.isLedgerAmountDerived).toBe(false);
            expect(candidate.currency).toBe('ETB');
            expect(candidate.reference).toBe('MP2610BND002');
            expect(candidate.currentBalance).toBe(282.0);
            expect(candidate.counterparty).toBe('Safaricom (0712345678)');
            expect(candidate.description).toContain('0712345678');
            expect(candidate.dateTime).toBe('2026-10-21T12:37:00+03:00');
            expect(candidate.warnings).toEqual([]);
        });
    });

    describe('Pattern 3: M-PESA Cashback (CREDIT)', () => {
        const syntheticCashbackSms = 'Congratulations, you have received a cashback of 0.60 Birr for Paying via M-PESA.';

        it('parses cashback as a potential CREDIT with explicit warnings for missing date and reference', () => {
            const result = parseMpesaSms(syntheticCashbackSms);

            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;

            const { candidate } = result;
            expect(candidate.providerId).toBe('mpesa');
            expect(candidate.type).toBe('CREDIT');
            expect(candidate.principalAmount).toBe(0.6);
            expect(candidate.ledgerAmount).toBe(0.6);
            expect(candidate.reference).toBeUndefined();
            expect(candidate.dateTime).toBeUndefined();
            expect(candidate.currentBalance).toBeUndefined();
            expect(candidate.description).toBe('M-PESA cashback');

            expect(candidate.warnings).toContain(
                'Transaction date was not provided in the SMS. Please confirm the date before importing.'
            );
            expect(candidate.warnings).toContain(
                'No transaction reference was found in the message. Duplicate detection relies on confirmed date and amount.'
            );
        });

        it('does not classify cashback message as promotional spam', () => {
            const result = parseSms(syntheticCashbackSms);

            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;
            expect(result.candidate.providerId).toBe('mpesa');
        });

        it('produces distinct fingerprints when user confirms different dates for repeated cashback amounts', () => {
            const baseResult = parseMpesaSms(syntheticCashbackSms);
            expect(baseResult.status).toBe('parsed');
            if (baseResult.status !== 'parsed') return;

            // Scenario: User receives identical 0.60 Birr cashback on two consecutive days
            const day1Candidate = {
                ...baseResult.candidate,
                dateTime: '2026-10-21T12:00:00+03:00',
            };
            const day2Candidate = {
                ...baseResult.candidate,
                dateTime: '2026-10-22T12:00:00+03:00',
            };

            const fp1 = generateSmsFingerprint(day1Candidate);
            const fp2 = generateSmsFingerprint(day2Candidate);

            expect(fp1).not.toBe(fp2);
            expect(fp1).toHaveLength(64);
            expect(fp2).toHaveLength(64);
        });

        it('parses M-PESA merchant payments correctly as DEBIT', () => {
            const sms =
                'Dear Customer, you have paid 250.00 Birr to Tomoca Coffee on 21/10/26 at 10:15 AM. ' +
                'Transaction number RA55443322. Your current M-PESA balance is 750.00 Birr.';

            const result = parseMpesaSms(sms);
            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;

            expect(result.candidate.providerId).toBe('mpesa');
            expect(result.candidate.type).toBe('DEBIT');
            expect(result.candidate.principalAmount).toBe(250);
            expect(result.candidate.counterparty).toBe('Tomoca Coffee');
            expect(result.candidate.reference).toBe('RA55443322');
            expect(result.candidate.currentBalance).toBe(750);
        });

        it('parses M-PESA outgoing P2P transfers correctly', () => {
            const sms =
                'Dear Customer, you have sent 500.00 Birr to 0712345678 (Abebe Bikila) on 21/10/26 at 02:45 PM. ' +
                'Transaction number RA99887766. Your current M-PESA balance is 250.00 Birr.';

            const result = parseMpesaSms(sms);
            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;

            expect(result.candidate.providerId).toBe('mpesa');
            expect(result.candidate.type).toBe('DEBIT');
            expect(result.candidate.principalAmount).toBe(500);
            expect(result.candidate.counterparty).toBe('0712345678 (Abebe Bikila)');
            expect(result.candidate.reference).toBe('RA99887766');
            expect(result.candidate.currentBalance).toBe(250);
        });
    });

    describe('Failure and Edge Cases', () => {
        it('returns malformed when amount is unparseable', () => {
            const malformedSms = 'Dear CUSTOMER, you have received NaN Birr from JOHN on 21/10/26 at 12:37 PM. Transaction number MP123.';
            const result = parseMpesaSms(malformedSms);
            expect(result.status).toBe('malformed');
        });

        it('adds a warning when date format is unrecognized', () => {
            const badDateSms =
                'Dear CUSTOMER, you have received 300.00 Birr from JOHN on Someday at Sometime. ' +
                'Transaction number is MP123. Your current M-PESA balance is 442.00 Birr.';
            const result = parseMpesaSms(badDateSms);
            expect(result.status).toBe('malformed');
        });

        it('returns malformed for unrecognized M-PESA text', () => {
            const randomMpesaSms = 'Safaricom M-PESA: Network maintenance scheduled for midnight.';
            const result = parseMpesaSms(randomMpesaSms);
            expect(result.status).toBe('malformed');
        });
    });
});
