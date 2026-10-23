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

    it('parses Telebirr P2P transfer with E-Money Account balance structure', () => {
        const sms =
            'Dear Customer, You have transferred ETB 50.00 to Zelalem(2519****9789) on 23/10/2026 17:22:20. ' +
            'Your transaction number is DJN07Y99ZQ. Your current E-Money Account balance is ETB 103.83. ' +
            'Thank you for using telebirr Ethio telecom';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        const { candidate } = result;
        expect(candidate.providerId).toBe('telebirr');
        expect(candidate.type).toBe('DEBIT');
        expect(candidate.principalAmount).toBe(50);
        expect(candidate.ledgerAmount).toBe(50);
        expect(candidate.counterparty).toBe('Zelalem(2519****9789)');
        expect(candidate.reference).toBe('DJN07Y99ZQ');
        expect(candidate.dateTime).toBe('2026-10-23T17:22:20+03:00');
        expect(candidate.currentBalance).toBe(103.83);
    });

    it('resiliently parses real-world partial Telebirr clip without throwing parse errors', () => {
        const sms =
            'Zelalem(2519****9789) on 23/10/2026 17:22:20. Your transaction number is DJN07Y99ZQ. ' +
            'Your current E-Money Account balance is ETB 103.83. Thank you for using telebirr Ethio telecom';

        const result = parseSms(sms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        const { candidate } = result;
        expect(candidate.providerId).toBe('telebirr');
        expect(candidate.type).toBe('DEBIT');
        expect(candidate.counterparty).toBe('Zelalem(2519****9789)');
        expect(candidate.reference).toBe('DJN07Y99ZQ');
        expect(candidate.dateTime).toBe('2026-10-23T17:22:20+03:00');
        expect(candidate.currentBalance).toBe(103.83);
        expect(candidate.warnings.length).toBeGreaterThan(0);
    });

    it('detects debited vs credited directions accurately in Telebirr notifications', () => {
        const debitedSms =
            'Your account has been debited with ETB 250.00 on 23/10/2026 14:15:00 for payment to Tomoca Coffee. ' +
            'Your transaction number is DJN999. Your current E-Money Account balance is ETB 500.00. Ethio telecom';
        const debitedResult = parseSms(debitedSms);
        expect(debitedResult.status).toBe('parsed');
        if (debitedResult.status === 'parsed') {
            expect(debitedResult.candidate.type).toBe('DEBIT');
            expect(debitedResult.candidate.principalAmount).toBe(250);
            expect(debitedResult.candidate.reference).toBe('DJN999');
        }

        const creditedSms =
            'Your account has been credited with ETB 1,500.00 on 23/10/2026 14:15:00 from Zelalem(2519****9789). ' +
            'Your transaction number is DJN888. Your current E-Money Account balance is ETB 2,000.00. Ethio telecom';
        const creditedResult = parseSms(creditedSms);
        expect(creditedResult.status).toBe('parsed');
        if (creditedResult.status === 'parsed') {
            expect(creditedResult.candidate.type).toBe('CREDIT');
            expect(creditedResult.candidate.principalAmount).toBe(1500);
            expect(creditedResult.candidate.reference).toBe('DJN888');
        }
    });

    it('parses Telebirr merchant payments correctly', () => {
        const merchantSms =
            'Dear Customer, You have paid ETB 350.00 to Merchant Tomoca Coffee on 23/10/2026 11:30:00. ' +
            'Your transaction number is TR554433. Your current balance is ETB 1,200.00. Thank you for using telebirr. Ethio telecom';

        const result = parseSms(merchantSms);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') return;

        expect(result.candidate.type).toBe('DEBIT');
        expect(result.candidate.principalAmount).toBe(350);
        expect(result.candidate.counterparty).toBe('Tomoca Coffee');
        expect(result.candidate.reference).toBe('TR554433');
    });
});
