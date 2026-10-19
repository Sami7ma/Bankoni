// A budget sets a spending limit for a specific category.
// Example: "Don't spend more than ETB 500 on Groceries this month"
// "Don't spend more than ETB 500 on Breakfast from Aug 21 to Aug 27."

export interface Budget {
    id: string;
    categoryId: string;           // Which category is this budget for? Links to Category.id
    limitAmount: number;          // The maximum you want to spend, e.g. 500.00
    startDate: string;            // When did you start tracking this budget?
    endDate: string;              // When does this budget end?
    recurring?: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
    alertThreshold?: number;      // Optional: alert at what %? e.g. 0.8 = warn at 80% spent
    walletId?: string | null;     // Optional: specific wallet limit or null/undefined for all wallets
}
