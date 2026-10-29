// utils/__tests__/date.test.ts

import { describe, expect, it } from '@jest/globals';
import {
    getEthiopianDateString,
    addDays,
    getDaysInclusive,
    getPeriodDateRange,
    formatEthiopianDateShort,
    formatEthiopianDate,
} from '../date';

describe('Ethiopian Local Date Utilities', () => {
    describe('Midnight and UTC+3 Timezone Boundary', () => {
        it('correctly maps 01:30 AM EAT to the current day and avoids UTC previous-day shift', () => {
            // In UTC, this is 2026-10-28T22:30:00.000Z.
            // Using toISOString().split('T')[0] would yield 2026-10-28 (BUG).
            // getEthiopianDateString must return 2026-10-29.
            const utcIsoString = '2026-10-28T22:30:00.000Z';
            expect(getEthiopianDateString(utcIsoString)).toBe('2026-10-29');

            const eatOffsetString = '2026-10-29T01:30:00+03:00';
            expect(getEthiopianDateString(eatOffsetString)).toBe('2026-10-29');
        });

        it('handles exact midnight 00:00:00+03:00 as current day', () => {
            // 2026-10-29T00:00:00+03:00 is 2026-10-28T21:00:00Z in UTC
            const exactMidnight = '2026-10-29T00:00:00+03:00';
            expect(getEthiopianDateString(exactMidnight)).toBe('2026-10-29');
        });

        it('handles 23:59:59+03:00 as previous day before midnight', () => {
            const beforeMidnight = '2026-10-28T23:59:59+03:00';
            expect(getEthiopianDateString(beforeMidnight)).toBe('2026-10-28');
        });

        it('handles 02:59:59+03:00 (just before UTC midnight)', () => {
            // 02:59:59 EAT is 23:59:59 UTC of previous calendar day
            const edgeTime = '2026-10-29T02:59:59+03:00';
            expect(getEthiopianDateString(edgeTime)).toBe('2026-10-29');
        });

        it('handles 03:00:00+03:00 (exact UTC midnight)', () => {
            const edgeTime = '2026-10-29T03:00:00+03:00';
            expect(getEthiopianDateString(edgeTime)).toBe('2026-10-29');
        });

        it('preserves pre-formatted YYYY-MM-DD strings via fast path', () => {
            expect(getEthiopianDateString('2026-10-29')).toBe('2026-10-29');
            expect(getEthiopianDateString('2025-01-01')).toBe('2025-01-01');
        });
    });

    describe('Calendar Date Arithmetic', () => {
        it('adds and subtracts days correctly across month boundaries', () => {
            expect(addDays('2026-10-29', -6)).toBe('2026-10-23');
            expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
            expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
            expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        });

        it('calculates inclusive calendar day counts accurately', () => {
            expect(getDaysInclusive('2026-10-23', '2026-10-29')).toBe(7);
            expect(getDaysInclusive('2026-10-01', '2026-10-31')).toBe(31);
            expect(getDaysInclusive('2026-10-29', '2026-10-29')).toBe(1);
            expect(getDaysInclusive('2026-10-29', '2026-10-20')).toBe(0);
        });
    });

    describe('Analytics Period Date Range Construction', () => {
        const refDate = '2026-10-29'; // Reference Thursday

        it('builds a fair, contiguous 7-day Week period and prior period', () => {
            const range = getPeriodDateRange('Week', refDate);
            expect(range.daysInPeriod).toBe(7);
            expect(range.startDate).toBe('2026-10-23');
            expect(range.endDate).toBe('2026-10-29');
            expect(range.priorEndDate).toBe('2026-10-22');
            expect(range.priorStartDate).toBe('2026-10-16');

            // Day counts must be identical for fair comparison
            expect(getDaysInclusive(range.startDate, range.endDate)).toBe(7);
            expect(getDaysInclusive(range.priorStartDate, range.priorEndDate)).toBe(7);

            // Exactly 7 daily buckets
            expect(range.labels.length).toBe(7);
            expect(range.bucketRanges.length).toBe(7);
            expect(range.bucketRanges[6].startDate).toBe('2026-10-29');
        });

        it('builds a fair 28-day Month period (4 weeks) with symmetrical prior period', () => {
            const range = getPeriodDateRange('Month', refDate);
            expect(range.daysInPeriod).toBe(28);
            expect(range.startDate).toBe('2026-10-02');
            expect(range.endDate).toBe('2026-10-29');
            expect(range.priorEndDate).toBe('2026-10-01');
            expect(range.priorStartDate).toBe('2026-09-04');

            expect(getDaysInclusive(range.startDate, range.endDate)).toBe(28);
            expect(getDaysInclusive(range.priorStartDate, range.priorEndDate)).toBe(28);

            expect(range.labels.length).toBe(4);
            expect(range.bucketRanges.length).toBe(4);
        });

        it('builds a 365-day Year period with symmetrical prior period and 12 monthly slices', () => {
            const range = getPeriodDateRange('Year', refDate);
            expect(range.daysInPeriod).toBe(365);
            expect(range.startDate).toBe('2025-10-30');
            expect(range.endDate).toBe('2026-10-29');
            expect(range.priorEndDate).toBe('2025-10-29');
            expect(range.priorStartDate).toBe('2024-10-30');

            expect(range.labels.length).toBe(12);
            expect(range.bucketRanges.length).toBe(12);
        });
    });

    describe('formatEthiopianDateShort', () => {
        it('formats ISO date strings nicely', () => {
            expect(formatEthiopianDateShort('2026-10-29')).toBe('Oct 29');
            expect(formatEthiopianDateShort('2026-01-05')).toBe('Jan 5');
        });
    });

    describe('formatEthiopianDate', () => {
        it('formats full calendar date string with year', () => {
            expect(formatEthiopianDate('2026-10-29')).toBe('Oct 29, 2026');
            expect(formatEthiopianDate('2026-01-05')).toBe('Jan 5, 2026');
        });
    });
});

