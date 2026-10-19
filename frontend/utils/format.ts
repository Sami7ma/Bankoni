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
}

/**
 * Formats a monetary amount as Ethiopian Birr with en-US grouping and exactly two decimal places.
 * Example: 1500 -> "ETB 1,500.00"
 */
export function formatEtb(amount: number, options: FormatEtbOptions = {}): string {
    const value = options.abs ? Math.abs(amount) : amount;
    return `ETB ${value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}
