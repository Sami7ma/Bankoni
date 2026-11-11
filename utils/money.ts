/** User-entered ETB: decimal point and optional correctly grouped thousands only.
 * Returns exact integer santim. No prefix parsing, rounding or currency guessing.
 * Kept separate from legacy provider parsing so other bank templates do not change.
 */
export function parseMoneyInput(input: string): number | null {
    const value = input.trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.replace(/,/g, '').split('.');
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}

/** NaN is deliberately retained for existing form validation; never a fallback amount. */
export function moneyInputEtb(input: string): number {
    const minor = parseMoneyInput(input);
    return minor == null ? NaN : minor / 100;
}

/** CBE permits a sentence full stop after a complete numeric token (e.g. 370.0.). */
export function parseCbeMoney(input: string | undefined): number | null {
    return input == null ? null : parseMoneyInput(input.replace(/\.$/, ''));
}
