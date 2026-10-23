// sms/__tests__/cbe_birr.test.ts
// Unit tests verifying CBE Birr non-transaction classification and handling.
// All tests use strictly synthetic, anonymized fixture strings.

import { describe, expect, it } from '@jest/globals';
import { parseSms } from '../index';
import { classifyMessage } from '../classifier';
import { detectProvider } from '../providers/detector';

describe('CBE Birr SMS Non-Transaction Classification', () => {
    // Synthetic sample matching real CBE Birr airtime receipt structure
    const syntheticAirtimeSms =
        'Dear Customer, you received 50.00Br. airtime from 0911223344 - ABEBE BIKILA on 09/04/26 14:36. ' +
        'Thank you for choosing CBE Birr! For Invoice use link https://example.com/invoice?TID=CB123456&PH=0911223344';

    // Synthetic sample matching CBE Birr app-store / promotional structure
    const syntheticPromoSms =
        'Experience our new CBE Birr app with enhanced features. Download now on Google Play: ' +
        'https://play.google.com/store/apps/details?id=com.cbe.cbebirr or Apple App Store.';

    describe('Airtime Receipt Handling', () => {
        it('classifies received airtime notification as non_transaction airtime_receipt', () => {
            const classification = classifyMessage(syntheticAirtimeSms);
            expect(classification.isNonTransaction).toBe(true);
            expect(classification.messageType).toBe('airtime_receipt');
            expect(classification.reason).toContain('Airtime delivery receipt');
        });

        it('parseSms stops before import and returns non_transaction status', () => {
            const result = parseSms(syntheticAirtimeSms);
            expect(result.status).toBe('non_transaction');
            if (result.status === 'non_transaction') {
                expect(result.messageType).toBe('airtime_receipt');
                expect(result.reason).toContain('Airtime delivery receipt');
            }
        });

        it('does not treat invoice URL parameters (TID, PH) as financial transaction references', () => {
            const result = parseSms(syntheticAirtimeSms);
            // Result must NOT be parsed into a candidate with reference CB123456
            expect(result.status).not.toBe('parsed');
        });

        it('guarantees the message does not create a transaction candidate or update a wallet balance', () => {
            const result = parseSms(syntheticAirtimeSms);
            expect(result.status).toBe('non_transaction');
            expect((result as any).candidate).toBeUndefined();
        });

        it('correctly detects CBE Birr provider signature', () => {
            const detected = detectProvider(syntheticAirtimeSms);
            expect(detected).toBe('cbe_birr');
            expect(detected).not.toBe('cbe');
        });
    });

    describe('Promotional / Informational Message Handling', () => {
        it('classifies CBE Birr app-store announcement as non_transaction promotional', () => {
            const classification = classifyMessage(syntheticPromoSms);
            expect(classification.isNonTransaction).toBe(true);
            expect(classification.messageType).toBe('promotional');
        });

        it('parseSms returns non_transaction for promotional message', () => {
            const result = parseSms(syntheticPromoSms);
            expect(result.status).toBe('non_transaction');
            if (result.status === 'non_transaction') {
                expect(result.messageType).toBe('promotional');
            }
        });
    });

    describe('Explicit Selection of CBE Birr', () => {
        it('safely rejects positive cash transaction parsing when cbe_birr is selected', () => {
            const randomText = 'CBE Birr: Some text without recognized transfer';
            const result = parseSms(randomText, 'cbe_birr');
            expect(result.status).toBe('non_transaction');
            if (result.status === 'non_transaction') {
                expect(result.reason).toContain('CBE Birr');
            }
        });
    });
});
