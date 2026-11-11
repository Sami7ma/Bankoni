// Defines the shape of every expense and income entry

// A "type alias " -crates a Custon type that can ONLY be one of these two strings.
export type TransactionType = 'CREDIT' | 'DEBIT';
// 'Credit = income (money coming in)
// 'Debit = expense (money coming out)

export type TransactionStatus = 'PENDING' | 'CLEARED';

/** CBE provenance contains no SMS body. Retains exact financial interpretation and evidence identity. */
export interface CbeFinancialDetails {
    provider:'cbe'; senderId:string; walletId:string; accountLast4:string;
    principalMinor:number; feeMinor:number; ledgerMinor:number;
    chargesMinor:{serviceCharge:number;vat:number;disasterFund:number;otherFees:number};
    currency:'ETB'; direction:'CREDIT'|'DEBIT'; reference?:string;
    evidence:{messageId:string;bodyHash:string;source:string};
    reviewReasons:string[]; reportingTimeZone:'Africa/Addis_Ababa';
}
//   'PENDING' = not yet confirmed
//   'CLEARED' = confirmed/completed


export interface Transaction {
    id: string;                   // Unique identifier (like a social security number for transactions)
    amount: number;               // How much? e.g. 250.00
    /** Integer santim is authoritative internally; amount is the legacy UI/backup ETB boundary. */
    amountMinor?: number;
    occurredAt?: number;
    /** A date-only event has no known clock time. Epoch is an ordering anchor, not measured time. */
    datePrecision?: import('../sms/eventTime').DatePrecision;
    eventDate?: string;
    receivedAt?: number;
    importedAt?: number;
    dateSource?: import('../sms/eventTime').DateSource;
    type: TransactionType;        // Income or Expense? Uses the type alias above
    categoryId: string;           // Which category? Links to a Category's id
    note?: string;                // Optional description (the ? means this field is OPTIONAL)
    date: string;                 // When? ISO format like "2026-08-12T09:00:00Z"
    status: TransactionStatus;    // Pending or Cleared?
    walletId: string;             // Which wallet/account was used?
    currentBalance?: number;      // Balance after this transaction (optional, calculated)
    source?: 'manual' | 'sms';    // Provenance of the transaction record
    smsReference?: string;        // Authoritative provider reference (e.g., FT..., RA...)
    smsFingerprint?: string;      // Deterministic deduplication hash
    smsDetails?: CbeFinancialDetails;
    isTransfer?: boolean;         // True if verified internal transfer between user's own wallets
    transferWalletId?: string;   // Paired destination or source wallet ID
    subType?: 'STANDARD' | 'TRANSFER' | 'REFUND' | 'REIMBURSEMENT' | 'SHARED_EXPENSE' | 'LOAN_DISBURSEMENT' | 'LOAN_REPAYMENT' | 'FEE' | 'INTEREST';
    counterparty?: string;        // Recipient, merchant, or counterparty name
    merchantId?: string;          // Linked Merchant ID if recognized
    educationInstitutionId?: string; // Linked Education Institution ID if recognized
    feeAmount?: number;           // Explicit transaction service fee
    vatAmount?: number;           // Explicit transaction VAT
    createdAt: string;            // When was this record created?
}

