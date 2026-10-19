// Defines the shape of every expense and income entry

// A "type alias " -crates a Custon type that can ONLY be one of these two strings.
export type TransactionType = 'CREDIT' | 'DEBIT';
// 'Credit = income (money coming in)
// 'Debit = expense (money coming out)

export type TransactionStatus = 'PENDING' | 'CLEARED';
//   'PENDING' = not yet confirmed
//   'CLEARED' = confirmed/completed


export interface Transaction {
    id: string;                   // Unique identifier (like a social security number for transactions)
    amount: number;               // How much? e.g. 250.00
    type: TransactionType;        // Income or Expense? Uses the type alias above
    categoryId: string;           // Which category? Links to a Category's id
    note?: string;                // Optional description (the ? means this field is OPTIONAL)
    date: string;                 // When? ISO format like "2026-08-12T09:00:00Z"
    status: TransactionStatus;    // Pending or Cleared?
    walletId: string;             // Which wallet/account was used?
    currentBalance?: number;      // Balance after this transaction (optional, calculated)
    createdAt: string;            // When was this record created?
}

