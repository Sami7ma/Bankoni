// types/FinancialRelationships.ts
// Domain models for financial relationships, merchant/education recognition,
// bill confirmations, telecom packages, and recurring commitments.

import type { Transaction } from './Transaction';

export type TransactionSubType =
    | 'STANDARD'
    | 'TRANSFER'
    | 'REFUND'
    | 'REIMBURSEMENT'
    | 'SHARED_EXPENSE'
    | 'LOAN_DISBURSEMENT'
    | 'LOAN_REPAYMENT'
    | 'FEE'
    | 'INTEREST';

export type MerchantType =
    | 'restaurant'
    | 'coffee_shop'
    | 'bakery'
    | 'groceries'
    | 'food'
    | 'other';

export interface Merchant {
    id: string;
    name: string;
    normalizedName: string;
    merchantType?: MerchantType;
    defaultCategoryId?: string;
    createdAt: string;
}

export interface MerchantAlias {
    id: string;
    alias: string;
    merchantId: string;
    createdAt: string;
}

export interface MerchantRule {
    id: string;
    pattern: string;
    merchantId: string;
    categoryId: string;
    autoApply: boolean;
    createdAt: string;
}

export type EducationFrequency = 'Semester' | 'Annual' | 'Quarterly' | 'Monthly' | 'One-off';
export type EducationFeeType = 'Tuition' | 'Registration' | 'Transport' | 'Books/Materials' | 'Uniform' | 'Other';

export interface EducationInstitution {
    id: string;
    name: string;
    normalizedName: string;
    defaultCategoryId?: string;
    preferredFrequency: EducationFrequency;
    preferredFeeType: EducationFeeType;
    createdAt: string;
}

export interface EducationCommitment {
    id: string;
    institutionId: string;
    studentName?: string;
    feeType: EducationFeeType;
    frequency: EducationFrequency;
    expectedAmount?: number;
    academicTerm?: string;
    academicYear?: string;
    createdAt: string;
}

export interface Transfer {
    id: string;
    fromTransactionId?: string;
    toTransactionId?: string;
    fromWalletId: string;
    toWalletId: string;
    amount: number;
    feeAmount?: number;
    feeTransactionId?: string;
    note?: string;
    createdAt: string;
}

export type AccountOwnership = 'OWN' | 'EXTERNAL';
export type AccountType = 'bank' | 'mobile_money' | 'wallet' | 'cash';

export interface KnownAccount {
    id: string;
    walletId?: string;
    providerId: string;
    accountType: AccountType;
    accountNumber: string;
    accountLast4?: string;
    displayName: string;
    maskedIdentifier: string;
    ownership: AccountOwnership;
    createdAt: string;
}

export type TransferMatchStatus =
    | 'OWN_ACCOUNT_MATCHED'      // Correlated with an existing opposite leg
    | 'OWN_ACCOUNT_CANDIDATE'    // Identified as own-account transfer leg
    | 'EXTERNAL_TRANSFER'        // Transfer to/from external party
    | 'STANDALONE';              // Ordinary transaction

export interface TransferCorrelationResult {
    status: TransferMatchStatus;
    isOwnAccountTransfer: boolean;
    sourceWalletId?: string;
    destinationWalletId?: string;
    sourceAccount?: KnownAccount;
    destinationAccount?: KnownAccount;
    principalAmount: number;
    feeAmount: number;
    totalDebitAmount: number;
    destinationCreditAmount: number;
    sourceReference?: string;
    destinationReference?: string;
    matchedTransactionId?: string;
    matchedTransaction?: Transaction;
    reconciledSourceBalance?: number;
    reconciledDestinationBalance?: number;
    reason: string;
}

export interface RefundAllocation {
    id: string;
    refundTransactionId: string;
    originalTransactionId?: string;
    allocatedAmount: number;
    notes?: string;
    createdAt: string;
}

export interface SharedExpense {
    id: string;
    transactionId: string;
    totalAmount: number;
    personalShare: number;
    description?: string;
    createdAt: string;
}

export interface SharedExpenseParticipant {
    id: string;
    sharedExpenseId: string;
    name: string;
    expectedAmount: number;
    paidAmount: number;
    createdAt: string;
}

export interface ReimbursementAllocation {
    id: string;
    reimbursementTransactionId: string;
    sharedExpenseId: string;
    participantId?: string;
    allocatedAmount: number;
    createdAt: string;
}

export interface SharedExpenseWithDetails extends SharedExpense {
    participants: SharedExpenseParticipant[];
    reimbursements: ReimbursementAllocation[];
    transaction?: Transaction;
    totalReimbursed: number;
    outstandingReceivable: number;
    realizedPersonalCost: number;
}

export type LoanType = 'LENT' | 'BORROWED';
export type LoanStatus = 'ACTIVE' | 'SETTLED' | 'DEFAULTED';

export interface Loan {
    id: string;
    type: LoanType;
    counterparty: string;
    principalAmount: number;
    disbursementTransactionId?: string;
    walletId?: string;
    interestRate?: number;
    dueDate?: string;
    status: LoanStatus;
    notes?: string;
    createdAt: string;
}

export interface LoanRepayment {
    id: string;
    loanId: string;
    transactionId?: string;
    principalRepaid: number;
    interestPaid: number;
    feePaid: number;
    repaymentDate: string;
    notes?: string;
    createdAt: string;
}

export interface LoanWithDetails extends Loan {
    repayments: LoanRepayment[];
    totalPrincipalRepaid: number;
    totalInterestPaid: number;
    totalFeePaid: number;
    remainingPrincipal: number;
}

export type BillConfirmationStatus = 'UNMATCHED' | 'MATCHED' | 'AMBIGUOUS';

export interface BillConfirmation {
    id: string;
    billerName: string;
    accountNumber?: string;
    billReference?: string;
    amount: number;
    confirmationCode?: string;
    rawMessage?: string;
    messageDate: string;
    status: BillConfirmationStatus;
    matchedTransactionId?: string;
    createdAt: string;
}

export type TelecomEventType =
    | 'PURCHASE'
    | 'ACTIVATION'
    | 'USAGE_ALERT'
    | 'DEPLETION'
    | 'EXPIRY'
    | 'RENEWAL';

export interface TelecomPackage {
    id: string;
    packageName: string;
    category: 'data' | 'voice' | 'sms' | 'combo' | 'unlimited';
    volumeMb?: number;
    smsCount?: number;
    voiceMinutes?: number;
    validityPeriod?: string;
    isActive: boolean;
    createdAt: string;
}

export interface TelecomEvent {
    id: string;
    packageInstanceId?: string;
    packageName: string;
    eventType: TelecomEventType;
    eventTime: string;
    price?: number;
    transactionId?: string;
    volumeText?: string;
    usagePercentage?: number;
    expiryTime?: string;
    rawSms?: string;
    createdAt: string;
}

export type CommitmentType =
    | 'subscription'
    | 'utility'
    | 'rent'
    | 'education'
    | 'telecom'
    | 'other';

export type CommitmentFrequency =
    | 'daily'
    | 'weekly'
    | 'biweekly'
    | 'monthly'
    | 'semester'
    | 'yearly';

export type CommitmentStatus = 'OBSERVED' | 'CONFIRMED' | 'PAUSED' | 'CANCELLED';

export interface RecurringCommitment {
    id: string;
    name: string;
    commitmentType: CommitmentType;
    categoryId: string;
    expectedAmount?: number;
    isVariableAmount: boolean;
    frequency: CommitmentFrequency;
    billingDay?: number;
    nextExpectedDate?: string;
    status: CommitmentStatus;
    merchantId?: string;
    institutionId?: string;
    walletId?: string;
    createdAt: string;
}
