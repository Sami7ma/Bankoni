// sms/types.ts
// Pure TypeScript domain types for BanKoni SMS transaction parsing.
// Independent of React, Zustand, and SQLite.

export type SmsProviderId = 'cbe' | 'dashen' | 'telebirr';

export interface FeeBreakdown {
    serviceCharge?: number;
    vat?: number;
    disasterFund?: number; // Disaster Fund / Disaster Recovery
    otherFees?: number;
    totalFees: number;
}

export interface ParsedTransactionCandidate {
    providerId: SmsProviderId;
    type: 'CREDIT' | 'DEBIT';
    /** Principal transfer or payment amount in ETB */
    principalAmount: number;
    /** The actual ledger amount that leaves or enters the wallet */
    ledgerAmount: number;
    /** Whether the ledger amount was explicitly stated in the SMS or derived from principal + fees */
    isLedgerAmountDerived: boolean;
    fees?: FeeBreakdown;
    currency: 'ETB';
    /** Masked account text or phone number from the message (e.g. 1000****1234 or 09****5678) */
    accountIdentifier?: string;
    /** Extracted last 4 digits for wallet matching, when available */
    accountLast4?: string;
    /** Recipient, counterparty, merchant, or sending/receiving institution */
    counterparty?: string;
    /** Authoritative bank or telebirr transaction reference */
    reference?: string;
    /** Secondary reference (e.g., bank reference alongside Telebirr reference) */
    secondaryReference?: string;
    /** ISO timestamp string in East Africa Time (+03:00) if extracted from SMS */
    dateTime?: string;
    /** Current balance after transaction in ETB, if stated */
    currentBalance?: number;
    /** Human-readable description/summary of the transaction */
    description: string;
    /** Raw SMS text parsed */
    rawSms: string;
    /** Non-blocking warnings that require user attention during review */
    warnings: string[];
}

export type SmsParseResult =
    | {
          status: 'parsed';
          candidate: ParsedTransactionCandidate;
      }
    | {
          status: 'unsupported_provider';
          reason: string;
      }
    | {
          status: 'non_transaction';
          reason: string;
          messageType?: 'otp' | 'atm_authorization' | 'airtime_receipt' | 'promotional' | 'failed_transaction';
      }
    | {
          status: 'ambiguous';
          reason: string;
          details?: Record<string, unknown>;
      }
    | {
          status: 'malformed';
          reason: string;
      };

export interface WalletMatchResult {
    matchedWalletId: string | null;
    confidence: 'exact_account' | 'provider_only' | 'ambiguous' | 'none';
    candidateWallets: string[];
}
