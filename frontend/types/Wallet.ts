// types/Wallet.ts
// A wallet represents a money account — physical cash, bank, or mobile money.
// Users can have multiple wallets to track where their money actually is.

export interface Wallet {
    id: string;
    name: string;                 // Display name like "Cash", "CBE Savings"
    icon: string;                 // Lucide icon or fallback key
    providerId: string;           // Provider catalogue ID ('cash', 'cbe', 'telebirr', 'custom')
    openingBalance: number;       // Legitimate starting balance (default 0)
    balance: number;              // Current balance: openingBalance + net cleared transactions
    currency: string;             // Currency code like "ETB"
    accountNumberLast4?: string;  // Optional last 4 digits / masked identifier
    isDefault: boolean;           // Pre-selected wallet when adding transactions
    isArchived: boolean;          // Safe archiving flag when transactions exist
    createdAt: string;
}
