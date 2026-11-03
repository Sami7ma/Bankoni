// sms/__tests__/telecomPackage.test.ts

import { describe, expect, it } from '@jest/globals';
import { parseTelecomPackageSms } from '../telecomPackage';

describe('Telecom Package Intelligence & Event Parser', () => {
    it('parses Example 1: Daily Internet Package 360 MB finished as DEPLETION service event', () => {
        const sms = 'Daily Internet Package 360 MB finished.';
        const result = parseTelecomPackageSms(sms);

        expect(result.isTelecomPackage).toBe(true);
        expect(result.isFinancialDebit).toBe(false); // No cash leaves wallet
        expect(result.eventType).toBe('DEPLETION');
        expect(result.packageName).toBe('Daily Internet Package 360 MB');
        expect(result.volumeText).toBe('360 MB');
        expect(result.price).toBeUndefined();
    });

    it('parses Example 2: Daily Internet Package 360 MB used 75%, with expiry as USAGE_ALERT', () => {
        const sms = 'Daily Internet Package 360 MB used 75%, with expiry 25/10/2026 23:59:59.';
        const result = parseTelecomPackageSms(sms);

        expect(result.isTelecomPackage).toBe(true);
        expect(result.isFinancialDebit).toBe(false);
        expect(result.eventType).toBe('USAGE_ALERT');
        expect(result.packageName).toBe('Daily Internet Package 360 MB');
        expect(result.volumeText).toBe('360 MB');
        expect(result.usagePercentage).toBe(75);
        expect(result.expiryTime).toBeDefined();
    });

    it('parses Example 3: Daily Internet Package 720 MB used 75%, keeping instance separate from 360 MB', () => {
        const sms = 'Daily Internet Package 720 MB used 75%, with expiry 25/10/2026 23:59:59.';
        const result = parseTelecomPackageSms(sms);

        expect(result.isTelecomPackage).toBe(true);
        expect(result.isFinancialDebit).toBe(false);
        expect(result.eventType).toBe('USAGE_ALERT');
        expect(result.packageName).toBe('Daily Internet Package 720 MB');
        expect(result.volumeText).toBe('720 MB');
        expect(result.usagePercentage).toBe(75);
    });

    it('parses Example 4: Daily Internet Package 360 MB received with expiry but no price as ACTIVATION', () => {
        const sms = 'You have received Daily Internet Package 360 MB valid until 25/10/2026 23:59:59.';
        const result = parseTelecomPackageSms(sms);

        expect(result.isTelecomPackage).toBe(true);
        expect(result.isFinancialDebit).toBe(false); // Zero-value transaction MUST NOT be created
        expect(result.eventType).toBe('ACTIVATION');
        expect(result.packageName).toBe('Daily Internet Package 360 MB');
        expect(result.volumeText).toBe('360 MB');
        expect(result.price).toBeUndefined();
    });

    it('parses Example 5: Two-hour unlimited internet offer activated as ACTIVATION event', () => {
        const sms = 'Two-hour unlimited internet offer activated on 25/10/2026 10:00:00, valid until 25/10/2026 12:00:00.';
        const result = parseTelecomPackageSms(sms);

        expect(result.isTelecomPackage).toBe(true);
        expect(result.isFinancialDebit).toBe(false);
        expect(result.eventType).toBe('ACTIVATION');
        expect(result.packageName).toBe('Two-hour unlimited internet offer');
        expect(result.activationTime).toBeDefined();
        expect(result.expiryTime).toBeDefined();
    });

    it('parses Example 6: Telebirr ETB 45 Monthly SMS Package 960 SMS purchase as PURCHASE financial debit', () => {
        const sms = 'Telebirr ETB 45 Monthly SMS Package 960 SMS purchase.';
        const result = parseTelecomPackageSms(sms);

        expect(result.isTelecomPackage).toBe(true);
        expect(result.isFinancialDebit).toBe(true); // Money leaves wallet!
        expect(result.eventType).toBe('PURCHASE');
        expect(result.packageName).toBe('Monthly SMS Package 960 SMS');
        expect(result.volumeText).toBe('960 SMS');
        expect(result.price).toBe(45);
    });

    it('distinguishes depletion from expiry', () => {
        const depletionSms = 'Daily Internet Package 360 MB finished.';
        const depletionResult = parseTelecomPackageSms(depletionSms);
        expect(depletionResult.eventType).toBe('DEPLETION');

        const alertSms = 'Daily Internet Package 360 MB used 75%, with expiry 25/10/2026.';
        const alertResult = parseTelecomPackageSms(alertSms);
        expect(alertResult.eventType).toBe('USAGE_ALERT');
        expect(alertResult.eventType).not.toBe('DEPLETION');
    });
});
