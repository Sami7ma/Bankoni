// utils/date.ts
//
// Pure date and time utilities for BanKoni.
//
// TIMEZONE SPECIFICATION:
// Ethiopia operates strictly on East Africa Time (EAT), which is fixed at UTC+3:00.
// Ethiopia does not observe Daylight Saving Time (DST).
//
// PROBLEM PREVENTED:
// In JavaScript, calling `new Date(isoString).toISOString().split('T')[0]` converts
// the date to UTC (Z). For any transaction occurring between midnight and 03:00 AM EAT,
// standard UTC conversion shifts the timestamp to the PREVIOUS calendar day:
// Example: 2026-10-29T01:30:00+03:00 becomes 2026-10-28T22:30:00Z -> "2026-10-28" (WRONG).
//
// These utilities guarantee that all transaction dates, budget periods, and analytics
// comparisons are evaluated in the local Ethiopian calendar date.

export const ETHIOPIA_TIMEZONE_OFFSET_HOURS = 3;
export const ETHIOPIA_TIMEZONE_OFFSET_MS = ETHIOPIA_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000;

const SHORT_MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Converts any date representation (ISO string, Date object, timestamp, or YYYY-MM-DD string)
 * to an authoritative local Ethiopian calendar date string: "YYYY-MM-DD".
 *
 * Handles timestamps with UTC offsets, UTC "Z" strings, and epoch milliseconds,
 * guaranteeing correct representation across the midnight-to-3:00 AM window.
 */
export function getEthiopianDateString(input: string | Date | number | undefined | null): string {
    if (!input) {
        return getTodayEthiopianDateString();
    }

    // Fast-path: if string is already formatted strictly as "YYYY-MM-DD"
    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            return trimmed;
        }
    }

    const dateObj = typeof input === 'object' && input instanceof Date ? input : new Date(input);
    const timeMs = dateObj.getTime();
    if (isNaN(timeMs)) {
        return getTodayEthiopianDateString();
    }

    // Shift UTC time by +3 hours to align with East Africa Time (UTC+3)
    const shiftedDate = new Date(timeMs + ETHIOPIA_TIMEZONE_OFFSET_MS);

    const year = shiftedDate.getUTCFullYear();
    const month = String(shiftedDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shiftedDate.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

/**
 * Returns today's calendar date string in Ethiopia (UTC+3).
 * Example: "2026-10-29"
 */
export function getTodayEthiopianDateString(): string {
    const now = Date.now();
    const shiftedDate = new Date(now + ETHIOPIA_TIMEZONE_OFFSET_MS);
    const year = shiftedDate.getUTCFullYear();
    const month = String(shiftedDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shiftedDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Adds or subtracts integer days to/from a "YYYY-MM-DD" calendar date.
 * Strictly operates on UTC midnight to prevent local machine DST or timezone shifts.
 */
export function addDays(dateStr: string, days: number): string {
    const parts = dateStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);

    const utcDate = new Date(Date.UTC(year, month, day));
    utcDate.setUTCDate(utcDate.getUTCDate() + days);

    const resYear = utcDate.getUTCFullYear();
    const resMonth = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
    const resDay = String(utcDate.getUTCDate()).padStart(2, '0');

    return `${resYear}-${resMonth}-${resDay}`;
}

/**
 * Calculates the number of calendar days between two "YYYY-MM-DD" dates inclusive.
 * Example: ("2026-10-01", "2026-10-07") -> 7 days.
 */
export function getDaysInclusive(startDateStr: string, endDateStr: string): number {
    const s = getUtcEpochDay(startDateStr);
    const e = getUtcEpochDay(endDateStr);
    if (isNaN(s) || isNaN(e) || e < s) return 0;
    return e - s + 1;
}

/**
 * Internal helper to convert "YYYY-MM-DD" into an integer epoch day.
 */
function getUtcEpochDay(dateStr: string): number {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return NaN;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const ms = Date.UTC(year, month, day);
    return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export type AnalyticsPeriod = 'Week' | 'Month' | 'Year';

export interface PeriodDateRange {
    period: AnalyticsPeriod;
    startDate: string;        // "YYYY-MM-DD" (inclusive)
    endDate: string;          // "YYYY-MM-DD" (inclusive)
    priorStartDate: string;   // "YYYY-MM-DD" for fair prior-period comparison
    priorEndDate: string;     // "YYYY-MM-DD" for fair prior-period comparison
    daysInPeriod: number;
    labels: string[];         // Chart bucket display labels
    bucketRanges: Array<{ startDate: string; endDate: string; label: string }>;
}

/**
 * Computes exact, consistent period boundaries and matching prior-period boundaries.
 * Guarantees that:
 * 1. Current period and prior period have identical day counts.
 * 2. Chart buckets, summary cards, and category breakdowns share the exact same boundaries.
 */
export function getPeriodDateRange(
    period: AnalyticsPeriod,
    referenceDateInput?: string | Date | number
): PeriodDateRange {
    const todayStr = getEthiopianDateString(referenceDateInput);

    if (period === 'Week') {
        // 7 calendar days: [today - 6, today]
        const daysInPeriod = 7;
        const startDate = addDays(todayStr, -6);
        const endDate = todayStr;

        const priorEndDate = addDays(startDate, -1);
        const priorStartDate = addDays(priorEndDate, -6);

        // Daily buckets: 7 individual days
        const bucketRanges: Array<{ startDate: string; endDate: string; label: string }> = [];
        const labels: string[] = [];

        for (let i = 6; i >= 0; i--) {
            const dayDateStr = addDays(todayStr, -i);
            const parts = dayDateStr.split('-');
            const utcDate = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
            const dayName = DAY_NAMES[utcDate.getUTCDay()];
            labels.push(dayName);
            bucketRanges.push({
                startDate: dayDateStr,
                endDate: dayDateStr,
                label: dayName,
            });
        }

        return {
            period,
            startDate,
            endDate,
            priorStartDate,
            priorEndDate,
            daysInPeriod,
            labels,
            bucketRanges,
        };
    }

    if (period === 'Month') {
        // 4 weeks (28 calendar days): [today - 27, today]
        // Provides 4 fair 7-day buckets that match prior-period symmetry.
        const daysInPeriod = 28;
        const startDate = addDays(todayStr, -27);
        const endDate = todayStr;

        const priorEndDate = addDays(startDate, -1);
        const priorStartDate = addDays(priorEndDate, -27);

        const bucketRanges: Array<{ startDate: string; endDate: string; label: string }> = [];
        const labels: string[] = [];

        for (let i = 3; i >= 0; i--) {
            const bEndDate = addDays(todayStr, -(i * 7));
            const bStartDate = addDays(bEndDate, -6);
            const startParts = bStartDate.split('-');
            const monthName = SHORT_MONTH_NAMES[parseInt(startParts[1], 10) - 1];
            const dayNum = parseInt(startParts[2], 10);
            const label = `${monthName} ${dayNum}`;
            labels.push(label);
            bucketRanges.push({
                startDate: bStartDate,
                endDate: bEndDate,
                label,
            });
        }

        return {
            period,
            startDate,
            endDate,
            priorStartDate,
            priorEndDate,
            daysInPeriod,
            labels,
            bucketRanges,
        };
    }

    // Year: 12 monthly buckets (365 calendar days)
    const daysInPeriod = 365;
    const startDate = addDays(todayStr, -364);
    const endDate = todayStr;

    const priorEndDate = addDays(startDate, -1);
    const priorStartDate = addDays(priorEndDate, -364);

    // 12 roughly 30-day buckets for chart display
    const bucketRanges: Array<{ startDate: string; endDate: string; label: string }> = [];
    const labels: string[] = [];

    // Build 12 monthly slices working backwards
    for (let i = 11; i >= 0; i--) {
        const approxDaysBackEnd = Math.round(i * (365 / 12));
        const approxDaysBackStart = Math.round((i + 1) * (365 / 12)) - 1;
        const bStartDate = addDays(todayStr, -approxDaysBackStart);
        const bEndDate = addDays(todayStr, -approxDaysBackEnd);
        const parts = bStartDate.split('-');
        const monthName = SHORT_MONTH_NAMES[parseInt(parts[1], 10) - 1];
        labels.push(monthName);
        bucketRanges.push({
            startDate: bStartDate,
            endDate: bEndDate,
            label: monthName,
        });
    }

    return {
        period,
        startDate,
        endDate,
        priorStartDate,
        priorEndDate,
        daysInPeriod,
        labels,
        bucketRanges,
    };
}

/**
 * Formats a "YYYY-MM-DD" date into user-friendly short format: "Oct 29".
 */
export function formatEthiopianDateShort(dateStr: string): string {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const monthIndex = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const month = SHORT_MONTH_NAMES[monthIndex] || parts[1];
    return `${month} ${day}`;
}

/**
 * Formats a "YYYY-MM-DD" date into user-friendly medium format: "Oct 29, 2026".
 */
export function formatEthiopianDate(dateStr: string): string {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parts[0];
    const monthIndex = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const month = SHORT_MONTH_NAMES[monthIndex] || parts[1];
    return `${month} ${day}, ${year}`;
}

