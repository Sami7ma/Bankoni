// sms/cleaners.ts
// String normalization, exact decimal monetary parsing (santim), and date-time helpers.

/**
 * Normalizes SMS text without altering meaningful digits, casing, or punctuation.
 * Removes invisible control characters, non-breaking spaces, and zero-width spaces.
 */
export function normalizeSmsText(text: string): string {
    if (!text) return '';
    return text
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width spaces
        .replace(/\u00A0/g, ' ')               // Non-breaking space
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')               // Collapse horizontal whitespace
        .trim();
}

/**
 * Parses a monetary string into integer minor units (1 ETB = 100 santim).
 * Uses string decomposition rather than floating-point math to prevent IEEE-754 precision issues.
 * Strips trailing sentence punctuation like periods or commas.
 * Examples:
 *   "1,300.0"    -> 130000
 *   "1,300.00."  -> 130000
 *   "0.50"       -> 50
 *   "0.08"       -> 8
 *   "0.03."      -> 3
 *   "300.61"     -> 30061
 *   "1312."      -> 131200
 */
export function parseSantim(raw: string | undefined | null): number | null {
    if (!raw) return null;
    const cleaned = raw.trim().replace(/[.,;:!?]+$/, '').replace(/,/g, '').trim();
    if (!cleaned) return null;

    // Pattern matches optional leading digits and optional decimal point
    const match = cleaned.match(/^(\d+)(?:\.(\d+))?$/);
    if (!match) return null;

    const wholeStr = match[1];
    let fracStr = match[2] || '';

    // If more than 2 decimal digits, round to nearest santim
    if (fracStr.length > 2) {
        const roundDigit = parseInt(fracStr[2], 10);
        let twoDigits = parseInt(fracStr.slice(0, 2), 10);
        if (roundDigit >= 5) {
            twoDigits += 1;
        }
        fracStr = twoDigits.toString().padStart(2, '0');
    } else {
        fracStr = fracStr.padEnd(2, '0');
    }

    const whole = parseInt(wholeStr, 10);
    const fraction = parseInt(fracStr, 10);

    if (!Number.isFinite(whole) || !Number.isFinite(fraction)) return null;

    return whole * 100 + fraction;
}

/**
 * Converts integer santim back into decimal ETB number.
 * Example: 130050 -> 1300.5
 */
export function santimToEtb(santim: number): number {
    return Number((santim / 100).toFixed(2));
}

/**
 * Formats santim into clean decimal string for display or comparisons.
 * Example: 130050 -> "1300.50"
 */
export function formatSantim(santim: number): string {
    const whole = Math.floor(santim / 100);
    const frac = Math.abs(santim % 100);
    return `${whole}.${frac.toString().padStart(2, '0')}`;
}

/**
 * Extracts the last 4 digits from an account string or phone number.
 * Examples:
 *   "1000****1234" -> "1234"
 *   "09****5678"   -> "5678"
 *   "100012345678" -> "5678"
 */
export function extractAccountLast4(accountText?: string): string | undefined {
    if (!accountText) return undefined;
    const match = accountText.match(/(\d{4})(?:[^\d]*)$/);
    return match ? match[1] : undefined;
}

/**
 * Parses Ethiopian date and time formats into an ISO 8601 string in East Africa Time (+03:00).
 * Handles:
 *  1. Dashen: "19/10/2026 at 12:22:25 PM" or "15/10/2026 at 04:10:28 PM"
 *  2. Telebirr: "21/10/2026 13:28:24"
 *  3. Telebirr ISO: "2026-10-21 13:27:14"
 *  4. Date-only: "19/10/2026"
 */
export function parseEthiopianDateTime(rawDate: string): string | null {
    if (!rawDate) return null;
    const text = normalizeSmsText(rawDate);

    // Format 1: DD/MM/YYYY at hh:mm:ss AM|PM (Dashen)
    const dashenMatch = text.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+at\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i
    );
    if (dashenMatch) {
        const day = dashenMatch[1].padStart(2, '0');
        const month = dashenMatch[2].padStart(2, '0');
        const year = dashenMatch[3];
        let hour = parseInt(dashenMatch[4], 10);
        const minute = dashenMatch[5];
        const second = dashenMatch[6];
        const period = dashenMatch[7].toUpperCase();

        if (period === 'PM' && hour < 12) hour += 12;
        if (period === 'AM' && hour === 12) hour = 0;

        const hourStr = hour.toString().padStart(2, '0');
        return `${year}-${month}-${day}T${hourStr}:${minute}:${second}+03:00`;
    }

    // Format 2: DD/MM/YYYY HH:mm:ss (Telebirr / General 24h)
    const dmy24Match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
    if (dmy24Match) {
        const day = dmy24Match[1].padStart(2, '0');
        const month = dmy24Match[2].padStart(2, '0');
        const year = dmy24Match[3];
        const hour = dmy24Match[4].padStart(2, '0');
        const minute = dmy24Match[5];
        const second = dmy24Match[6];
        return `${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`;
    }

    // Format 3: YYYY-MM-DD HH:mm:ss (Telebirr incoming transfer)
    const ymd24Match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
    if (ymd24Match) {
        const year = ymd24Match[1];
        const month = ymd24Match[2].padStart(2, '0');
        const day = ymd24Match[3].padStart(2, '0');
        const hour = ymd24Match[4].padStart(2, '0');
        const minute = ymd24Match[5];
        const second = ymd24Match[6];
        return `${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`;
    }

    // Format 4: DD/MM/YYYY date only
    const dateOnlyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dateOnlyMatch) {
        const day = dateOnlyMatch[1].padStart(2, '0');
        const month = dateOnlyMatch[2].padStart(2, '0');
        const year = dateOnlyMatch[3];
        return `${year}-${month}-${day}T00:00:00+03:00`;
    }

    return null;
}
