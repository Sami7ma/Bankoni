// sms/__tests__/cleaners.test.ts
// Unit tests for SMS text normalization, santim arithmetic, and date parsing.

import { describe, expect, it } from '@jest/globals';
import {
    normalizeSmsText,
    parseSantim,
    santimToEtb,
    extractAccountLast4,
    parseEthiopianDateTime,
} from '../cleaners';

describe('SMS Cleaners & Arithmetic', () => {
    describe('normalizeSmsText', () => {
        it('removes zero-width and non-breaking spaces', () => {
            const raw = 'Dear\u200B Customer,\u00A0A debit transaction\r\nof ETB 100.00';
            expect(normalizeSmsText(raw)).toBe('Dear Customer, A debit transaction\nof ETB 100.00');
        });

        it('collapses multiple whitespace spaces into single space', () => {
            const raw = 'You    have   transferred   ETB  500';
            expect(normalizeSmsText(raw)).toBe('You have transferred ETB 500');
        });
    });

    describe('parseSantim & santimToEtb', () => {
        it('parses standard currency strings with commas into exact santim integers', () => {
            expect(parseSantim('1,300.0')).toBe(130000);
            expect(parseSantim('1,300.00')).toBe(130000);
            expect(parseSantim('1300')).toBe(130000);
            expect(parseSantim('0.50')).toBe(50);
            expect(parseSantim('0.08')).toBe(8);
            expect(parseSantim('0.03')).toBe(3);
            expect(parseSantim('300.61')).toBe(30061);
            expect(parseSantim('840,060.64')).toBe(84006064);
        });

        it('returns null on invalid input', () => {
            expect(parseSantim('')).toBeNull();
            expect(parseSantim('abc')).toBeNull();
            expect(parseSantim(null)).toBeNull();
            expect(parseSantim(undefined)).toBeNull();
        });

        it('converts santim integer back to ETB decimal correctly', () => {
            expect(santimToEtb(130000)).toBe(1300);
            expect(santimToEtb(30061)).toBe(300.61);
            expect(santimToEtb(50)).toBe(0.5);
            expect(santimToEtb(8)).toBe(0.08);
            expect(santimToEtb(3)).toBe(0.03);
        });
    });

    describe('extractAccountLast4', () => {
        it('extracts last 4 digits from masked account and phone numbers', () => {
            expect(extractAccountLast4('1000****1234')).toBe('1234');
            expect(extractAccountLast4('09****5678')).toBe('5678');
            expect(extractAccountLast4('100012345678')).toBe('5678');
            expect(extractAccountLast4('1000****1234.')).toBe('1234');
        });

        it('returns undefined if no 4 consecutive digits exist', () => {
            expect(extractAccountLast4('abc')).toBeUndefined();
            expect(extractAccountLast4('')).toBeUndefined();
            expect(extractAccountLast4(undefined)).toBeUndefined();
        });
    });

    describe('parseEthiopianDateTime', () => {
        it('parses Dashen 12-hour AM/PM format to East Africa Time (+03:00) ISO string', () => {
            const parsedPm = parseEthiopianDateTime('19/10/2026 at 12:22:25 PM');
            expect(parsedPm).toBe('2026-10-19T12:22:25+03:00');

            const parsedAfternoon = parseEthiopianDateTime('15/10/2026 at 04:10:28 PM');
            expect(parsedAfternoon).toBe('2026-10-15T16:10:28+03:00');

            const parsedMorning = parseEthiopianDateTime('01/05/2026 at 09:15:00 AM');
            expect(parsedMorning).toBe('2026-05-01T09:15:00+03:00');
        });

        it('parses Telebirr 24-hour DD/MM/YYYY format', () => {
            const parsed = parseEthiopianDateTime('21/10/2026 13:28:24');
            expect(parsed).toBe('2026-10-21T13:28:24+03:00');
        });

        it('parses Telebirr 24-hour YYYY-MM-DD format', () => {
            const parsed = parseEthiopianDateTime('2026-10-21 13:27:14');
            expect(parsed).toBe('2026-10-21T13:27:14+03:00');
        });

        it('parses M-PESA 2-digit year AM/PM format with omitted seconds', () => {
            const parsed = parseEthiopianDateTime('21/10/26 at 12:37 PM');
            expect(parsed).toBe('2026-10-21T12:37:00+03:00');
        });

        it('parses 24-hour 2-digit year format with omitted seconds (CBE Birr)', () => {
            const parsed = parseEthiopianDateTime('09/04/26 14:36');
            expect(parsed).toBe('2026-04-09T14:36:00+03:00');
        });

        it('parses Awash YYYY-MM-DD HH:mm:ss format', () => {
            const parsed = parseEthiopianDateTime('2026-10-14 08:32:28');
            expect(parsed).toBe('2026-10-14T08:32:28+03:00');
        });

        it('parses date-only 2-digit year DD/MM/YY format', () => {
            const parsed = parseEthiopianDateTime('21/10/26');
            expect(parsed).toBe('2026-10-21T00:00:00+03:00');
        });

        it('returns null on invalid date text or out-of-range values', () => {
            expect(parseEthiopianDateTime('invalid date text')).toBeNull();
            expect(parseEthiopianDateTime('32/13/2026 at 25:61 PM')).toBeNull();
            expect(parseEthiopianDateTime('')).toBeNull();
        });
    });
});
