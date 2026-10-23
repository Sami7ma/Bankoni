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
 * Expands a 2-digit or 4-digit year string into a 4-digit year.
 * Follows standard 2000-century pivot: 00-69 -> 2000-2069; 70-99 -> 1970-1999.
 * Example: "26" -> "2026", "2026" -> "2026"
 */
export function expandTwoDigitYear(yearStr: string): string {
    if (yearStr.length === 4) return yearStr;
    const yy = parseInt(yearStr, 10);
    if (isNaN(yy)) return yearStr;
    const fullYear = yy < 70 ? 2000 + yy : 1900 + yy;
    return fullYear.toString();
}

/**
 * Parses Ethiopian date and time formats into an ISO 8601 string in East Africa Time (+03:00).
 * Handles:
 *  1. Dashen & M-PESA: "19/10/2026 at 12:22:25 PM" or "21/10/26 at 12:37 PM"
 *  2. Telebirr & CBE Birr 24h: "21/10/2026 13:28:24" or "09/04/26 14:36"
 *  3. Telebirr & Awash: "2026-10-14 08:32:28" or "2026-10-21 13:27:14"
 *  4. Date-only: "19/10/2026" or "21/10/26"
 */
export function parseEthiopianDateTime(rawDate: string): string | null {
    if (!rawDate) return null;
    const text = normalizeSmsText(rawDate);

    // Format 1: DD/MM/YY or DD/MM/YYYY at hh:mm[:ss] AM|PM (Dashen, M-PESA)
    const ampmMatch = text.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+at\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i
    );
    if (ampmMatch) {
        const day = ampmMatch[1].padStart(2, '0');
        const month = ampmMatch[2].padStart(2, '0');
        const year = expandTwoDigitYear(ampmMatch[3]);
        let hour = parseInt(ampmMatch[4], 10);
        const minute = ampmMatch[5].padStart(2, '0');
        const second = ampmMatch[6] ? ampmMatch[6].padStart(2, '0') : '00';
        const period = ampmMatch[7].toUpperCase();

        if (period === 'PM' && hour < 12) hour += 12;
        if (period === 'AM' && hour === 12) hour = 0;

        if (parseInt(month, 10) < 1 || parseInt(month, 10) > 12) return null;
        if (parseInt(day, 10) < 1 || parseInt(day, 10) > 31) return null;
        if (hour < 0 || hour > 23) return null;
        if (parseInt(minute, 10) < 0 || parseInt(minute, 10) > 59) return null;
        if (parseInt(second, 10) < 0 || parseInt(second, 10) > 59) return null;

        const hourStr = hour.toString().padStart(2, '0');
        return `${year}-${month}-${day}T${hourStr}:${minute}:${second}+03:00`;
    }

    // Format 2: DD/MM/YY or DD/MM/YYYY HH:mm[:ss] (Telebirr / CBE Birr 24h)
    const dmy24Match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (dmy24Match) {
        const day = dmy24Match[1].padStart(2, '0');
        const month = dmy24Match[2].padStart(2, '0');
        const year = expandTwoDigitYear(dmy24Match[3]);
        const hour = parseInt(dmy24Match[4], 10);
        const minute = dmy24Match[5].padStart(2, '0');
        const second = dmy24Match[6] ? dmy24Match[6].padStart(2, '0') : '00';

        if (parseInt(month, 10) < 1 || parseInt(month, 10) > 12) return null;
        if (parseInt(day, 10) < 1 || parseInt(day, 10) > 31) return null;
        if (hour < 0 || hour > 23) return null;
        if (parseInt(minute, 10) < 0 || parseInt(minute, 10) > 59) return null;
        if (parseInt(second, 10) < 0 || parseInt(second, 10) > 59) return null;

        const hourStr = hour.toString().padStart(2, '0');
        return `${year}-${month}-${day}T${hourStr}:${minute}:${second}+03:00`;
    }

    // Format 3: YYYY-MM-DD HH:mm[:ss] (Telebirr incoming transfer, Awash Bank)
    const ymd24Match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (ymd24Match) {
        const year = ymd24Match[1];
        const month = ymd24Match[2].padStart(2, '0');
        const day = ymd24Match[3].padStart(2, '0');
        const hour = parseInt(ymd24Match[4], 10);
        const minute = ymd24Match[5].padStart(2, '0');
        const second = ymd24Match[6] ? ymd24Match[6].padStart(2, '0') : '00';

        if (parseInt(month, 10) < 1 || parseInt(month, 10) > 12) return null;
        if (parseInt(day, 10) < 1 || parseInt(day, 10) > 31) return null;
        if (hour < 0 || hour > 23) return null;
        if (parseInt(minute, 10) < 0 || parseInt(minute, 10) > 59) return null;
        if (parseInt(second, 10) < 0 || parseInt(second, 10) > 59) return null;

        const hourStr = hour.toString().padStart(2, '0');
        return `${year}-${month}-${day}T${hourStr}:${minute}:${second}+03:00`;
    }

    // Format 4: DD/MM/YY or DD/MM/YYYY date only
    const dateOnlyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (dateOnlyMatch) {
        const day = dateOnlyMatch[1].padStart(2, '0');
        const month = dateOnlyMatch[2].padStart(2, '0');
        const year = expandTwoDigitYear(dateOnlyMatch[3]);

        if (parseInt(month, 10) < 1 || parseInt(month, 10) > 12) return null;
        if (parseInt(day, 10) < 1 || parseInt(day, 10) > 31) return null;

        return `${year}-${month}-${day}T00:00:00+03:00`;
    }

    return null;
}

/**
 * Automatically detects whether an SMS represents an Income (CREDIT) or Expense (DEBIT)
 * by evaluating directional banking keywords (especially 'debited' vs 'credited').
 */
export function detectDirectionFromKeywords(
    text: string,
    defaultType: 'DEBIT' | 'CREDIT' = 'DEBIT'
): { type: 'DEBIT' | 'CREDIT'; matchedKeyword?: string } {
    const lower = text.toLowerCase();

    // 1. Explicit directional verbs take highest priority
    const hasDebited = /\bdebited\b/i.test(lower);
    const hasCredited = /\bcredited\b/i.test(lower);

    if (hasDebited && !hasCredited) return { type: 'DEBIT', matchedKeyword: 'debited' };
    if (hasCredited && !hasDebited) return { type: 'CREDIT', matchedKeyword: 'credited' };

    // 2. Incoming / Income indicators
    const creditPatterns: Array<{ re: RegExp; kw: string }> = [
        { re: /\byou\s+have\s+received\b/i, kw: 'received' },
        { re: /\breceived\s+a\s+cashback\b/i, kw: 'cashback' },
        { re: /\b(?:cash-?in|deposit|deposited)\b/i, kw: 'deposit' },
        { re: /\btransferred\s+(?:(?:ETB|Birr)\s*[\d,.]+\s+)?from\b/i, kw: 'transferred from' },
        { re: /\bsent\s+(?:(?:ETB|Birr)\s*[\d,.]+\s+)?from\b/i, kw: 'sent from' },
        { re: /\bcredit\b/i, kw: 'credit' },
    ];

    for (const { re, kw } of creditPatterns) {
        if (re.test(lower)) return { type: 'CREDIT', matchedKeyword: kw };
    }

    // 3. Outgoing / Expense indicators
    const debitPatterns: Array<{ re: RegExp; kw: string }> = [
        { re: /\byou\s+have\s+transferred\b/i, kw: 'transferred' },
        { re: /\btransferred\s+(?:(?:ETB|Birr)\s*[\d,.]+\s+)?to\b/i, kw: 'transferred to' },
        { re: /\byou\s+have\s+paid\b/i, kw: 'paid' },
        { re: /\bpayment\s+(?:of|to|for)\b/i, kw: 'payment' },
        { re: /\b(?:bought|purchase|purchased)\b/i, kw: 'purchase' },
        { re: /\bpackage\b/i, kw: 'package' },
        { re: /\b(?:withdrawn|withdrawal|cash-?out)\b/i, kw: 'withdrawn' },
        { re: /\bsent\s+(?:(?:ETB|Birr)\s*[\d,.]+\s+)?to\b/i, kw: 'sent to' },
        { re: /\bdebit\b/i, kw: 'debit' },
    ];

    for (const { re, kw } of debitPatterns) {
        if (re.test(lower)) return { type: 'DEBIT', matchedKeyword: kw };
    }

    // 4. Default fallback
    return { type: defaultType };
}

