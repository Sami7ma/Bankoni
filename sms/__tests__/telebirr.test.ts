// sms/__tests__/telebirr.test.ts
// Unit tests for Telebirr SMS parser using synthetic fixtures.

import { describe, expect, it } from '@jest/globals';
import { parseSms } from '../index';

describe('Telebirr SMS Parser', () => {
    it('parses Telebirr outgoing bank transfer with derived fees and dual references (Section 6.5)', () => {
        const sms =
            'Dear Customer, You have transferred ETB 1,000.00 successfully from your telebirr account 09****1234 ' +
            'to Commercial Bank of Ethiopia account number 1000****5678 on 21/10/2026 13:28:24. ' +
            'Your telebirr transaction number is RA26102199 and your bank transaction number is FT88776655. ' +
            'The service fee is ETB 5.22 and 15% VAT on the service fee is ETB 0.78. Your current balance is ETB 383.83. ' +
            'To download your payment information please click this link: https://telebirr.et/receipt/123. Thank you for using telebirr. Ethio telecom.';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        const { candidate } = result;
        expect(candidate.providerId).toBe('telebirr');
        expect(candidate.type).toBe('DEBIT');
        expect(candidate.principalAmount).toBe(1000);
        // Explicit calculation: 1000 + 5.22 + 0.78 = 1006.00
        expect(candidate.ledgerAmount).toBe(1006);
        expect(candidate.isLedgerAmountDerived).toBe(true);

        expect(candidate.fees).toBeDefined();
        expect(candidate.fees?.serviceCharge).toBe(5.22);
        expect(candidate.fees?.vat).toBe(0.78);
        expect(candidate.fees?.totalFees).toBe(6);

        expect(candidate.accountIdentifier).toBe('09****1234');
        expect(candidate.accountLast4).toBe('1234');
        expect(candidate.counterparty).toBe('Commercial Bank of Ethiopia (Acct 1000****5678)');
        expect(candidate.reference).toBe('RA26102199');
        expect(candidate.secondaryReference).toBe('FT88776655');
        expect(candidate.dateTime).toBe('2026-10-21T13:28:24+03:00');
        expect(candidate.currentBalance).toBe(383.83);
    });

    it('parses Telebirr incoming transfer from CBE (Section 6.6)', () => {
        const sms =
            'Dear Customer, You have received ETB 1,300.00 by transaction number 2610211327 on 2026-10-21 13:27:14 ' +
            'from Commercial Bank of Ethiopia to your telebirr Account 09****4321 - DERARTU TULU. ' +
            'Your current balance is ETB 1,389.83. Thank you for using telebirr. Ethio telecom.';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        const { candidate } = result;
        expect(candidate.providerId).toBe('telebirr');
        expect(candidate.type).toBe('CREDIT');
        expect(candidate.principalAmount).toBe(1300);
        expect(candidate.ledgerAmount).toBe(1300);
        expect(candidate.reference).toBe('2610211327');
        expect(candidate.dateTime).toBe('2026-10-21T13:27:14+03:00');
        expect(candidate.counterparty).toBe('Commercial Bank of Ethiopia');
        expect(candidate.accountIdentifier).toBe('09****4321');
        expect(candidate.accountLast4).toBe('4321');
        expect(candidate.currentBalance).toBe(1389.83);
    });

    it('parses Telebirr package purchase as outgoing debit (Section 6.7)', () => {
        const sms =
            'Dear Customer, You have paid ETB 15.00 for package Monthly Unlimited Internet purchase made for 09****7777 ' +
            'on 20/10/2026 15:56:37. Your transaction number is TRX987654. Your current balance is ETB 450.25. ' +
            'Thank you for using telebirr. Ethio telecom.';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        const { candidate } = result;
        expect(candidate.providerId).toBe('telebirr');
        expect(candidate.type).toBe('DEBIT');
        expect(candidate.principalAmount).toBe(15);
        expect(candidate.ledgerAmount).toBe(15);
        expect(candidate.description).toBe('Package: Monthly Unlimited Internet');
        expect(candidate.accountIdentifier).toBe('09****7777');
        expect(candidate.accountLast4).toBe('7777');
        expect(candidate.dateTime).toBe('2026-10-20T15:56:37+03:00');
        expect(candidate.reference).toBe('TRX987654');
        expect(candidate.currentBalance).toBe(450.25);
    });

    it('rejects Telebirr ATM withdrawal authorization secret code as non-transaction', () => {
        const atmSms =
            'Dear Customer, your telebirr ATM withdrawal secret code is 849201 for ETB 500.00 withdrawal request. ' +
            'Valid for 15 minutes. Ethio telecom.';

        const result = parseSms(atmSms);
        expect(result.status).toBe('non_transaction');
        if (result.status === 'non_transaction') {
            expect(result.messageType).toBe('atm_authorization');
        }
    });

    it('rejects Telebirr airtime receipt as non-transaction', () => {
        const airtimeSms =
            'you have received ETB 25.00 airtime from 0911223344. transaction number is AT998877. Ethio telecom.';

        const result = parseSms(airtimeSms);
        expect(result.status).toBe('non_transaction');
        if (result.status === 'non_transaction') {
            expect(result.messageType).toBe('airtime_receipt');
        }
    });
});
