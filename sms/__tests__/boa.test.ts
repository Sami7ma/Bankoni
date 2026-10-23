// sms/__tests__/boa.test.ts
// Unit tests for Bank of Abyssinia (BOA) SMS transaction parsing.
// All tests use strictly synthetic, anonymized fixture strings.

import { describe, expect, it } from '@jest/globals';
import { parseBoaSms, extractBoaReceiptReference } from '../providers/boa';
import { parseSms } from '../index';

describe('Bank of Abyssinia (BOA) SMS Parsing', () => {
    // Synthetic verified sample matching real BOA debit structure
    const syntheticBoaDebitSms =
        'Dear KASSAHUN, your account 1000****5678 was debited with ETB 1,006.00. Available Balance: ETB 10,862.76. ' +
        'Receipt: https://cs.bankofabyssinia.com/slip/?trx=FT2610ABCDEF ' +
        'Feedback: https://cs.bankofabyssinia.com/cs/?trx=DFT98765432 ' +
        'Link your Fayda: https://example.com/fayda For help, call 8397 (24/7 Toll-Free). Bank of Abyssinia.';

    describe('Pattern 1: Verified Debit Format (DEBIT)', () => {
        it('parses debit with ledger amount, accountLast4, available balance, and receipt reference', () => {
            const result = parseBoaSms(syntheticBoaDebitSms);

            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;

            const { candidate } = result;
            expect(candidate.providerId).toBe('boa');
            expect(candidate.type).toBe('DEBIT');
            expect(candidate.principalAmount).toBe(1006.0);
            expect(candidate.ledgerAmount).toBe(1006.0);
            expect(candidate.isLedgerAmountDerived).toBe(false);
            expect(candidate.currency).toBe('ETB');
            expect(candidate.accountIdentifier).toBe('1000****5678');
            expect(candidate.accountLast4).toBe('5678');
            expect(candidate.currentBalance).toBe(10862.76);
            expect(candidate.reference).toBe('FT2610ABCDEF');
            expect(candidate.dateTime).toBeUndefined();

            // Date missing warning must be present
            expect(candidate.warnings).toContain(
                'Transaction date was not provided in the SMS. Please confirm the date before importing.'
            );
        });

        it('strictly extracts reference from receipt slip URL and never from feedback URL', () => {
            const ref = extractBoaReceiptReference(syntheticBoaDebitSms);
            expect(ref).toBe('FT2610ABCDEF');
            expect(ref).not.toBe('DFT98765432');
        });

        it('ignores Fayda URLs and toll-free numbers without contaminating transaction fields', () => {
            const result = parseBoaSms(syntheticBoaDebitSms);
            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;

            expect(result.candidate.reference).not.toContain('fayda');
            expect(result.candidate.reference).not.toContain('8397');
        });

        it('auto-detects BOA provider correctly', () => {
            const result = parseSms(syntheticBoaDebitSms);
            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;
            expect(result.candidate.providerId).toBe('boa');
        });
    });

    describe('Pattern 2: Provisional Incoming Credit (Reconstructed from Partial Screenshot)', () => {
        // Clearly labelled as reconstructed provisional fixture
        const provisionalReconstructedCreditSms =
            'Dear KASSAHUN, your account 1000****5678 has been credited with ETB 5,000.00 from ABEBE BIKILA. ' +
            'Available Balance: ETB 15,862.76. Receipt: https://cs.bankofabyssinia.com/slip/?trx=FT2610CRED01. Bank of Abyssinia.';

        it('parses provisional credit format with explicit human-review warning', () => {
            const result = parseBoaSms(provisionalReconstructedCreditSms);

            expect(result.status).toBe('parsed');
            if (result.status !== 'parsed') return;

            const { candidate } = result;
            expect(candidate.providerId).toBe('boa');
            expect(candidate.type).toBe('CREDIT');
            expect(candidate.principalAmount).toBe(5000.0);
            expect(candidate.ledgerAmount).toBe(5000.0);
            expect(candidate.counterparty).toBe('ABEBE BIKILA');
            expect(candidate.reference).toBe('FT2610CRED01');
            expect(candidate.currentBalance).toBe(15862.76);

            // Must include provisional warning
            expect(candidate.warnings.some((w) => w.includes('PROVISIONAL'))).toBe(true);
        });
    });

    describe('Failure and Edge Cases', () => {
        it('returns malformed when debit amount is invalid', () => {
            const badAmountSms = 'Dear CUSTOMER, your account 1000****5678 was debited with ETB 0.00. Bank of Abyssinia.';
            const result = parseBoaSms(badAmountSms);
            expect(result.status).toBe('malformed');
        });

        it('returns malformed for unrecognized BOA text', () => {
            const randomBoaSms = 'Bank of Abyssinia: Notice of scheduled maintenance on internet banking.';
            const result = parseBoaSms(randomBoaSms);
            expect(result.status).toBe('malformed');
        });
    });
});
