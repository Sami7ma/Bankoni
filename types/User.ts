// frontend/types/User.ts

import type { Transaction } from './Transaction';
import type { Category } from './Category';
import type { Budget } from './Budget';
import type { Wallet } from './Wallet';

export interface User {
    id: string;
    name: string;
    email?: string;
    isBiometricEnabled: boolean;
    createdAt: string;
}

export interface UserPreferencesPayload {
    theme?: 'dark' | 'light';
    budgetAlertsEnabled?: boolean;
    popupAlertsEnabled?: boolean;
    alertThreshold?: number;
}

export interface ExportDataPayload {
    selection?: import('../db/backupSelection').ExportSelection;
    version: string;
    exportedAt: string;
    user: User | null;

    wallets: Wallet[];
    categories: Category[];
    budgets: Budget[];
    transactions: Transaction[];

    summary: {
        totalTransactions: number;
        totalBalance: number;
        totalIncome: number;
        totalExpenses: number;
        currency: string;
    };

    settings?: UserPreferencesPayload;
    /** Version 2 portable financial snapshot. Never includes users or auth credentials. */
    financialTables?: import('../db/portableBackup').FinancialSnapshot;
}
