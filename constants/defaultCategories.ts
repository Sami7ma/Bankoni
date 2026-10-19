// constants/defaultCategories.ts
// The built-in categories that ship with the app.
// Users can add custom categories later, but these are always available.

import { Category } from '../types/Category';

// Expense categories — things you spend money on
export const defaultExpenseCategories: Category[] = [
    { id: 'cat-1', name: 'Gas', iconKey: 'local_gas_station', flow: 'EXPENSE', essential: true, recurring: true, isBuiltIn: true, isCustom: false },
    { id: 'cat-2', name: 'Breakfast', iconKey: 'free_breakfast', flow: 'EXPENSE', essential: false, recurring: false, isBuiltIn: true, isCustom: false },
    { id: 'cat-3', name: 'Lunch', iconKey: 'restaurant', flow: 'EXPENSE', essential: false, recurring: false, isBuiltIn: true, isCustom: false },
    { id: 'cat-4', name: 'Groceries', iconKey: 'shopping_cart', flow: 'EXPENSE', essential: true, recurring: true, isBuiltIn: true, isCustom: false },
    { id: 'cat-5', name: 'Books', iconKey: 'book', flow: 'EXPENSE', essential: false, recurring: false, isBuiltIn: true, isCustom: false },
    { id: 'cat-6', name: 'Internet Package', iconKey: 'wifi', flow: 'EXPENSE', essential: true, recurring: true, isBuiltIn: true, isCustom: false },
    { id: 'cat-7', name: 'Skincare', iconKey: 'spa', flow: 'EXPENSE', essential: false, recurring: false, isBuiltIn: true, isCustom: false },
    { id: 'cat-8', name: 'Subscription', iconKey: 'subscriptions', flow: 'EXPENSE', essential: false, recurring: true, isBuiltIn: true, isCustom: false },
    { id: 'cat-9', name: 'Transport', iconKey: 'directions_car', flow: 'EXPENSE', essential: true, recurring: true, isBuiltIn: true, isCustom: false },
    { id: 'cat-10', name: 'Rent', iconKey: 'home', flow: 'EXPENSE', essential: true, recurring: true, isBuiltIn: true, isCustom: false },
    { id: 'cat-11', name: 'Utilities', iconKey: 'bolt', flow: 'EXPENSE', essential: true, recurring: true, isBuiltIn: true, isCustom: false },
    { id: 'cat-12', name: 'Health', iconKey: 'health_and_safety', flow: 'EXPENSE', essential: true, recurring: false, isBuiltIn: true, isCustom: false },
    { id: 'cat-13', name: 'Clothing', iconKey: 'checkroom', flow: 'EXPENSE', essential: false, recurring: false, isBuiltIn: true, isCustom: false },
    { id: 'cat-14', name: 'Misc', iconKey: 'more_horiz', flow: 'EXPENSE', essential: false, recurring: false, isBuiltIn: true, isCustom: false },
    { id: 'cat-15', name: 'Entertainment', iconKey: 'movie', flow: 'EXPENSE', essential: false, recurring: false, isBuiltIn: true, isCustom: false },
];

// Income categories — ways you earn money
export const defaultIncomeCategories: Category[] = [
    { id: 'cat-16', name: 'Salary', iconKey: 'banknote', flow: 'INCOME', essential: true, recurring: true, isBuiltIn: true, isCustom: false },
    { id: 'cat-17', name: 'Business', iconKey: 'building_2', flow: 'INCOME', essential: true, recurring: false, isBuiltIn: true, isCustom: false },
    { id: 'cat-18', name: 'Side Hustle', iconKey: 'laptop', flow: 'INCOME', essential: false, recurring: false, isBuiltIn: true, isCustom: false },
    { id: 'cat-19', name: 'Bonus', iconKey: 'award', flow: 'INCOME', essential: false, recurring: false, isBuiltIn: true, isCustom: false },
    { id: 'cat-20', name: 'Refund', iconKey: 'rotate_ccw', flow: 'INCOME', essential: false, recurring: false, isBuiltIn: true, isCustom: false },
];

// Combined — all categories in one array using spread
export const defaultCategories = [
    ...defaultExpenseCategories,
    ...defaultIncomeCategories
];