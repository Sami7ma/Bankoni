// utils/format.ts
//
// Presentation formatting utilities.
// Strictly for UI display formatting, NOT for financial calculations or storage.

export interface FormatEtbOptions {
    /**
     * When true, takes Math.abs(amount) before formatting.
     * Used by BalanceCards and BudgetCard to display positive magnitudes.
     */
    abs?: boolean;
    /**
     * Number of decimal places to display. Defaults to 2.
     * Use 0 for whole-birr displays (e.g. rounded budget limits or summaries).
     */
    decimals?: number;
}

/**
 * Formats a monetary amount as Ethiopian Birr with en-US grouping and configurable decimals.
 * Follows standard international financial formatting:
 *   Positive: "ETB 1,500.00"
 *   Negative: "-ETB 1,500.00"
 *   Zero / near-zero: "ETB 0.00" (suppresses negative zero)
 */
export function formatEtb(amount: number, options: FormatEtbOptions = {}): string {
    const decimals = options.decimals ?? 2;
    const rawValue = options.abs ? Math.abs(amount) : amount;

    // Prevent negative zero: if value rounds to zero at the chosen precision, treat as 0
    const threshold = Math.pow(10, -decimals) / 2;
    const isZero = Math.abs(rawValue) < threshold;
    const isNegative = !options.abs && !isZero && rawValue < 0;
    const absValue = isZero ? 0 : Math.abs(rawValue);

    const formatted = absValue.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });

    return isNegative ? `-ETB ${formatted}` : `ETB ${formatted}`;
}

