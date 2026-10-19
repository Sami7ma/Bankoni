
// Defines what a spending/income category looks like.
// This type can ONLY be 'expense' or 'income' — nothing else
export type CategoryFlow = 'EXPENSE' | 'INCOME';

export interface Category {
    id: string;              // Unique ID like 'cat-1'
    name: string;            // Display name like 'Groceries'
    iconKey: string;         // Icon identifier like 'shopping_cart'
    colorKey?: string;       // Optional accent color for this category
    flow: CategoryFlow;      // Is this for expenses or income?
    essential: boolean;      // true = needs (rent, food), false = wants (entertainment)
    recurring: boolean;      // true = happens regularly (rent, salary)
    isBuiltIn: boolean;      // true = default category, can't be deleted
    isCustom: boolean;       // true = user created this category
}
