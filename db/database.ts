// Local-first SQLite repository for BanKoni.
// Production startup intentionally does not insert sample transactions or budgets.

import {mergeSelectedTables} from './backupSelection';
import type * as SQLite from 'expo-sqlite';
import { createDatabaseOwner } from './platform';
import { exportFinancialTables, restoreFinancialTables, FINANCIAL_TABLES } from './portableBackup';
import { isEarnedIncome, isPersonalSpending } from '../utils/financial';
import { transactionInsert } from './transactionSql';
import { LEDGER_COLUMNS, LEDGER_INTEGRITY_SQL, ledgerBalance, cbeBalanceEvidence, CBE_BALANCE_SCHEMA } from './ledgerIntegrity';
import { COMPANION_INBOX_SCHEMA, type InboxRow } from '../sms/companion/schema';
import { RECEIPTS_SCHEMA, duplicateQuery, type ImportPlan } from '../sms/automatic/plan';
import type { Transaction } from '../types/Transaction';
import type { Budget } from '../types/Budget';
import type { Category } from '../types/Category';
import type { Wallet } from '../types/Wallet';
import type { User, ExportDataPayload, UserPreferencesPayload } from '../types/User';
import type {
    Merchant,
    MerchantAlias,
    MerchantRule,
    EducationInstitution,
    EducationCommitment,
    Transfer,
    RefundAllocation,
    SharedExpense,
    SharedExpenseParticipant,
    ReimbursementAllocation,
    SharedExpenseWithDetails,
    Loan,
    LoanRepayment,
    LoanWithDetails,
    LoanType,
    LoanStatus,
    BillConfirmation,
    BillConfirmationStatus,
    TelecomPackage,
    TelecomEvent,
    TelecomEventType,
    RecurringCommitment,
    CommitmentStatus,
    KnownAccount,
} from '../types/FinancialRelationships';
import { defaultCategories, defaultIncomeCategories } from '../constants/defaultCategories';
import type { DatabaseReader } from './connectionOwner';

const DATABASE_VERSION = 7;

const connectionOwner = createDatabaseOwner();
let initPromise: Promise<void> | null = null;

interface UserRow {
    id: string;
    name: string;
    email: string | null;
    pin_hash: string;
    is_biometric_enabled: number;
    created_at: string;
}

interface TransactionRow {
    sms_details?: string | null;
    amount_minor?: number | null;
    occurred_at?: number | null;
    received_at?: number | null;
    imported_at?: number | null;
    date_source?: Transaction['dateSource'] | null;
    date_precision?: Transaction['datePrecision'] | null;
    event_date?: string | null;
    id: string;
    amount: number;
    type: 'CREDIT' | 'DEBIT';
    category_id: string;
    note: string | null;
    date: string;
    status: 'PENDING' | 'CLEARED';
    wallet_id: string;
    current_balance: number | null;
    source: string | null;
    raw_sms: string | null;
    sms_reference: string | null;
    sms_fingerprint: string | null;
    is_transfer?: number | null;
    transfer_wallet_id?: string | null;
    sub_type?: string | null;
    counterparty?: string | null;
    merchant_id?: string | null;
    education_institution_id?: string | null;
    fee_amount?: number | null;
    vat_amount?: number | null;
    created_at: string;
}

interface BudgetRow {
    id: string;
    category_id: string;
    limit_amount: number;
    start_date: string;
    end_date: string;
    recurring: string | null;
    alert_threshold: number | null;
    wallet_id: string | null;
}

interface CategoryRow {
    id: string;
    name: string;
    icon_key: string;
    color_key: string | null;
    flow: 'EXPENSE' | 'INCOME';
    essential: number;
    recurring: number;
    is_built_in: number;
    is_custom: number;
}

interface WalletRow {
    id: string;
    name: string;
    icon: string;
    provider_id: string | null;
    balance_mode?: string;
    bank_balance_as_of?: number;
    bank_balance_date_source?: string;
    opening_balance: number | null;
    balance: number;
    currency: string;
    account_number_last4: string | null;
    is_default: number;
    is_archived: number | null;
    created_at: string;
}

async function withExclusiveTransaction<T>(
    work: (transaction: SQLite.SQLiteDatabase) => Promise<T>,
): Promise<T> {
    await initDatabase();
    return connectionOwner.withExclusiveTransaction(work);
}

export async function getDatabase(): Promise<DatabaseReader> {
    await initDatabase();
    return connectionOwner.getReader();
}

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    pin_hash TEXT NOT NULL,
    avatar_url TEXT,
    is_biometric_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_biometric_enabled IN (0, 1)),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon_key TEXT NOT NULL,
    color_key TEXT,
    flow TEXT CHECK(flow IN ('EXPENSE', 'INCOME')) NOT NULL,
    essential INTEGER NOT NULL DEFAULT 0 CHECK (essential IN (0, 1)),
    recurring INTEGER NOT NULL DEFAULT 0 CHECK (recurring IN (0, 1)),
    is_built_in INTEGER NOT NULL DEFAULT 0 CHECK (is_built_in IN (0, 1)),
    is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1))
  );

  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    provider_id TEXT NOT NULL DEFAULT 'custom',
    opening_balance REAL NOT NULL DEFAULT 0.0,
    balance REAL NOT NULL DEFAULT 0.0,
    currency TEXT NOT NULL DEFAULT 'ETB',
    account_number_last4 TEXT,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    amount REAL NOT NULL CHECK (amount > 0),
    type TEXT CHECK(type IN ('CREDIT', 'DEBIT')) NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id),
    note TEXT,
    date TEXT NOT NULL,
    status TEXT CHECK(status IN ('PENDING', 'CLEARED')) NOT NULL DEFAULT 'CLEARED',
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    current_balance REAL,
    source TEXT DEFAULT 'manual',
    raw_sms TEXT,
    sms_reference TEXT,
    sms_fingerprint TEXT,
    is_transfer INTEGER NOT NULL DEFAULT 0 CHECK (is_transfer IN (0, 1)),
    transfer_wallet_id TEXT REFERENCES wallets(id),
    sub_type TEXT DEFAULT 'STANDARD',
    counterparty TEXT,
    merchant_id TEXT,
    education_institution_id TEXT,
    fee_amount REAL,
    vat_amount REAL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    limit_amount REAL NOT NULL CHECK (limit_amount >= 0),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    recurring TEXT DEFAULT 'monthly',
    alert_threshold REAL DEFAULT 0.8 CHECK (alert_threshold IS NULL OR (alert_threshold >= 0 AND alert_threshold <= 1)),
    wallet_id TEXT REFERENCES wallets(id)
  );

  CREATE TABLE IF NOT EXISTS auth_security (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
    lockout_until_ms INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO auth_security (id, failed_pin_attempts, lockout_until_ms) VALUES (1, 0, 0);

  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    merchant_type TEXT,
    default_category_id TEXT REFERENCES categories(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS merchant_aliases (
    id TEXT PRIMARY KEY,
    alias TEXT NOT NULL UNIQUE,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS merchant_rules (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id),
    auto_apply INTEGER NOT NULL DEFAULT 1 CHECK (auto_apply IN (0, 1)),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS education_institutions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    default_category_id TEXT REFERENCES categories(id),
    preferred_frequency TEXT NOT NULL DEFAULT 'Semester',
    preferred_fee_type TEXT NOT NULL DEFAULT 'Tuition',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS education_commitments (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL REFERENCES education_institutions(id) ON DELETE CASCADE,
    student_name TEXT,
    fee_type TEXT NOT NULL DEFAULT 'Tuition',
    frequency TEXT NOT NULL DEFAULT 'Semester',
    expected_amount REAL,
    academic_term TEXT,
    academic_year TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    from_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    to_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    from_wallet_id TEXT NOT NULL REFERENCES wallets(id),
    to_wallet_id TEXT NOT NULL REFERENCES wallets(id),
    amount REAL NOT NULL CHECK (amount > 0),
    fee_amount REAL DEFAULT 0,
    fee_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refund_allocations (
    id TEXT PRIMARY KEY,
    refund_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    original_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    allocated_amount REAL NOT NULL CHECK (allocated_amount > 0),
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shared_expenses (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    total_amount REAL NOT NULL CHECK (total_amount > 0),
    personal_share REAL NOT NULL CHECK (personal_share >= 0),
    description TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shared_expense_participants (
    id TEXT PRIMARY KEY,
    shared_expense_id TEXT NOT NULL REFERENCES shared_expenses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    expected_amount REAL NOT NULL CHECK (expected_amount >= 0),
    paid_amount REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reimbursement_allocations (
    id TEXT PRIMARY KEY,
    reimbursement_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    shared_expense_id TEXT NOT NULL REFERENCES shared_expenses(id) ON DELETE CASCADE,
    participant_id TEXT REFERENCES shared_expense_participants(id) ON DELETE SET NULL,
    allocated_amount REAL NOT NULL CHECK (allocated_amount > 0),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('LENT', 'BORROWED')),
    counterparty TEXT NOT NULL,
    principal_amount REAL NOT NULL CHECK (principal_amount > 0),
    disbursement_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    wallet_id TEXT REFERENCES wallets(id),
    interest_rate REAL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SETTLED', 'DEFAULTED')),
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS loan_repayments (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    principal_repaid REAL NOT NULL DEFAULT 0 CHECK (principal_repaid >= 0),
    interest_paid REAL NOT NULL DEFAULT 0 CHECK (interest_paid >= 0),
    fee_paid REAL NOT NULL DEFAULT 0 CHECK (fee_paid >= 0),
    repayment_date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bill_confirmations (
    id TEXT PRIMARY KEY,
    biller_name TEXT NOT NULL,
    account_number TEXT,
    bill_reference TEXT,
    amount REAL NOT NULL CHECK (amount > 0),
    confirmation_code TEXT,
    raw_message TEXT,
    message_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'UNMATCHED' CHECK (status IN ('UNMATCHED', 'MATCHED', 'AMBIGUOUS')),
    matched_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telecom_packages (
    id TEXT PRIMARY KEY,
    package_name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('data', 'voice', 'sms', 'combo', 'unlimited')),
    volume_mb REAL,
    sms_count INTEGER,
    voice_minutes INTEGER,
    validity_period TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telecom_events (
    id TEXT PRIMARY KEY,
    package_instance_id TEXT,
    package_name TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('PURCHASE', 'ACTIVATION', 'USAGE_ALERT', 'DEPLETION', 'EXPIRY', 'RENEWAL')),
    event_time TEXT NOT NULL,
    price REAL,
    transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    volume_text TEXT,
    usage_percentage REAL,
    expiry_time TEXT,
    raw_sms TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recurring_commitments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    commitment_type TEXT NOT NULL CHECK (commitment_type IN ('subscription', 'utility', 'rent', 'education', 'telecom', 'other')),
    category_id TEXT NOT NULL REFERENCES categories(id),
    expected_amount REAL,
    is_variable_amount INTEGER NOT NULL DEFAULT 0 CHECK (is_variable_amount IN (0, 1)),
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'semester', 'yearly')),
    billing_day INTEGER,
    next_expected_date TEXT,
    status TEXT NOT NULL DEFAULT 'OBSERVED' CHECK (status IN ('OBSERVED', 'CONFIRMED', 'PAUSED', 'CANCELLED')),
    merchant_id TEXT REFERENCES merchants(id) ON DELETE SET NULL,
    institution_id TEXT REFERENCES education_institutions(id) ON DELETE SET NULL,
    wallet_id TEXT REFERENCES wallets(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS known_accounts (
    id TEXT PRIMARY KEY,
    wallet_id TEXT REFERENCES wallets(id) ON DELETE SET NULL,
    provider_id TEXT NOT NULL,
    account_type TEXT NOT NULL DEFAULT 'bank',
    account_number TEXT NOT NULL,
    account_last4 TEXT,
    display_name TEXT NOT NULL,
    masked_identifier TEXT NOT NULL,
    ownership TEXT NOT NULL DEFAULT 'OWN' CHECK (ownership IN ('OWN', 'EXTERNAL')),
    created_at TEXT NOT NULL
  );
`;

const INDEXES_AND_TRIGGERS_SQL = `
  CREATE INDEX IF NOT EXISTS idx_transactions_date_created
    ON transactions(date DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_id);
  CREATE INDEX IF NOT EXISTS idx_budgets_category ON budgets(category_id);
  CREATE INDEX IF NOT EXISTS idx_budgets_wallet ON budgets(wallet_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_profile ON users ((1));
  CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_single_default ON wallets(is_default) WHERE is_default = 1;
  DROP INDEX IF EXISTS idx_transactions_unique_sms_ref;
  CREATE INDEX IF NOT EXISTS idx_transactions_sms_account_ref_lookup
    ON transactions(wallet_id, type, sms_reference COLLATE NOCASE) WHERE sms_reference IS NOT NULL;
  -- Triggers enforce case-insensitive uniqueness without discarding legacy case-variant rows.
  CREATE TRIGGER IF NOT EXISTS trg_sms_reference_insert BEFORE INSERT ON transactions
  WHEN NEW.sms_reference IS NOT NULL AND EXISTS (
    SELECT 1 FROM transactions WHERE wallet_id=NEW.wallet_id AND type=NEW.type
      AND sms_reference=NEW.sms_reference COLLATE NOCASE
  ) BEGIN SELECT RAISE(ABORT, 'SMS reference already imported for this account and direction'); END;
  CREATE TRIGGER IF NOT EXISTS trg_sms_reference_update BEFORE UPDATE OF sms_reference,wallet_id,type ON transactions
  WHEN NEW.sms_reference IS NOT NULL AND EXISTS (
    SELECT 1 FROM transactions WHERE id<>NEW.id AND wallet_id=NEW.wallet_id AND type=NEW.type
      AND sms_reference=NEW.sms_reference COLLATE NOCASE
  ) BEGIN SELECT RAISE(ABORT, 'SMS reference already imported for this account and direction'); END;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_sms_fingerprint ON transactions(sms_fingerprint) WHERE sms_fingerprint IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_transfers_from_wallet ON transfers(from_wallet_id);
  CREATE INDEX IF NOT EXISTS idx_transfers_to_wallet ON transfers(to_wallet_id);
  CREATE INDEX IF NOT EXISTS idx_refund_allocations_orig ON refund_allocations(original_transaction_id);
  CREATE INDEX IF NOT EXISTS idx_refund_allocations_refund ON refund_allocations(refund_transaction_id);
  CREATE INDEX IF NOT EXISTS idx_shared_expenses_tx ON shared_expenses(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_shared_expense_parts ON shared_expense_participants(shared_expense_id);
  CREATE INDEX IF NOT EXISTS idx_reimb_allocations_shared ON reimbursement_allocations(shared_expense_id);
  CREATE INDEX IF NOT EXISTS idx_loans_counterparty ON loans(counterparty);
  CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
  CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan ON loan_repayments(loan_id);
  CREATE INDEX IF NOT EXISTS idx_bill_confirmations_status ON bill_confirmations(status);
  CREATE INDEX IF NOT EXISTS idx_telecom_events_type ON telecom_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_telecom_events_pkg ON telecom_events(package_instance_id);
  CREATE INDEX IF NOT EXISTS idx_recurring_commitments_status ON recurring_commitments(status);
  CREATE INDEX IF NOT EXISTS idx_known_accounts_provider_last4 ON known_accounts(provider_id, account_last4);
  CREATE INDEX IF NOT EXISTS idx_known_accounts_number ON known_accounts(account_number);
  CREATE INDEX IF NOT EXISTS idx_known_accounts_wallet ON known_accounts(wallet_id);

  -- These guards complement PRAGMA foreign_keys.
  CREATE TRIGGER IF NOT EXISTS trg_transactions_validate_insert
  BEFORE INSERT ON transactions
  WHEN NOT EXISTS (
    SELECT 1 FROM categories
    WHERE id = NEW.category_id
      AND flow = CASE WHEN NEW.type = 'DEBIT' THEN 'EXPENSE' ELSE 'INCOME' END
  ) OR NOT EXISTS (SELECT 1 FROM wallets WHERE id = NEW.wallet_id)
  BEGIN SELECT RAISE(ABORT, 'Transaction requires a matching category and existing wallet'); END;

  CREATE TRIGGER IF NOT EXISTS trg_transactions_validate_update
  BEFORE UPDATE OF category_id, wallet_id, type ON transactions
  WHEN NOT EXISTS (
    SELECT 1 FROM categories
    WHERE id = NEW.category_id
      AND flow = CASE WHEN NEW.type = 'DEBIT' THEN 'EXPENSE' ELSE 'INCOME' END
  ) OR NOT EXISTS (SELECT 1 FROM wallets WHERE id = NEW.wallet_id)
  BEGIN SELECT RAISE(ABORT, 'Transaction requires a matching category and existing wallet'); END;

  CREATE TRIGGER IF NOT EXISTS trg_budgets_validate_insert
  BEFORE INSERT ON budgets
  WHEN NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND flow = 'EXPENSE')
  BEGIN SELECT RAISE(ABORT, 'Budget requires an existing expense category'); END;

  CREATE TRIGGER IF NOT EXISTS trg_budgets_validate_update
  BEFORE UPDATE OF category_id ON budgets
  WHEN NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND flow = 'EXPENSE')
  BEGIN SELECT RAISE(ABORT, 'Budget requires an existing expense category'); END;

  CREATE TRIGGER IF NOT EXISTS trg_categories_protect_delete
  BEFORE DELETE ON categories
  WHEN OLD.is_built_in = 1
    OR EXISTS (SELECT 1 FROM transactions WHERE category_id = OLD.id)
    OR EXISTS (SELECT 1 FROM budgets WHERE category_id = OLD.id)
  BEGIN SELECT RAISE(ABORT, 'Category is built in or is still referenced'); END;

  CREATE TRIGGER IF NOT EXISTS trg_wallets_protect_delete
  BEFORE DELETE ON wallets
  WHEN OLD.is_default = 1
    OR EXISTS (SELECT 1 FROM transactions WHERE wallet_id = OLD.id)
  BEGIN SELECT RAISE(ABORT, 'Wallet is default or is still referenced'); END;
`;

async function ensureColumnsExist(db: SQLite.SQLiteDatabase): Promise<void> {
    const getCols = async (tbl: string) => {
        try {
            const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tbl});`);
            return new Set(rows.map((r) => r.name.toLowerCase()));
        } catch {
            return new Set<string>();
        }
    };

    // Budgets table
    const budgetCols = await getCols('budgets');
    if (budgetCols.size > 0 && !budgetCols.has('wallet_id')) {
        await db.runAsync('ALTER TABLE budgets ADD COLUMN wallet_id TEXT REFERENCES wallets(id);');
    }

    // Wallets table
    const walletCols = await getCols('wallets');
    if (walletCols.size > 0) {
        if (!walletCols.has('provider_id')) {
            await db.runAsync("ALTER TABLE wallets ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'custom';");
        }
        if (!walletCols.has('balance_mode')) await db.runAsync("ALTER TABLE wallets ADD COLUMN balance_mode TEXT NOT NULL DEFAULT 'ledger';");
        if (!walletCols.has('opening_balance')) {
            await db.runAsync('ALTER TABLE wallets ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0.0;');
        }
        if (!walletCols.has('account_number_last4')) {
            await db.runAsync('ALTER TABLE wallets ADD COLUMN account_number_last4 TEXT;');
        }
        if (!walletCols.has('is_archived')) {
            await db.runAsync('ALTER TABLE wallets ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;');
        }
    }

    // Categories table
    const categoryCols = await getCols('categories');
    if (categoryCols.size > 0) {
        if (!categoryCols.has('color_key')) {
            await db.runAsync('ALTER TABLE categories ADD COLUMN color_key TEXT;');
        }
        if (!categoryCols.has('is_custom')) {
            await db.runAsync('ALTER TABLE categories ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0;');
        }
    }

    // Transactions table
    const txCols = await getCols('transactions');
    if (txCols.size > 0) {
        for (const [column, type] of Object.entries(LEDGER_COLUMNS)) {
            if (!txCols.has(column)) await db.runAsync(`ALTER TABLE transactions ADD COLUMN ${column} ${type};`);
        }
        if (!txCols.has('wallet_id')) {
            await db.runAsync("ALTER TABLE transactions ADD COLUMN wallet_id TEXT NOT NULL DEFAULT 'wallet-cash-default' REFERENCES wallets(id);");
        }
        if (!txCols.has('current_balance')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN current_balance REAL;');
        }
        if (!txCols.has('source')) {
            await db.runAsync("ALTER TABLE transactions ADD COLUMN source TEXT DEFAULT 'manual';");
        }
        if (!txCols.has('raw_sms')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN raw_sms TEXT;');
        }
        if (!txCols.has('sms_reference')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN sms_reference TEXT;');
        }
        if (!txCols.has('sms_fingerprint')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN sms_fingerprint TEXT;');
        }
        if (!txCols.has('is_transfer')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN is_transfer INTEGER NOT NULL DEFAULT 0;');
        }
        if (!txCols.has('transfer_wallet_id')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN transfer_wallet_id TEXT REFERENCES wallets(id);');
        }
        if (!txCols.has('sub_type')) {
            await db.runAsync("ALTER TABLE transactions ADD COLUMN sub_type TEXT DEFAULT 'STANDARD';");
        }
        if (!txCols.has('counterparty')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN counterparty TEXT;');
        }
        if (!txCols.has('merchant_id')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN merchant_id TEXT REFERENCES merchants(id);');
        }
        if (!txCols.has('education_institution_id')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN education_institution_id TEXT REFERENCES education_institutions(id);');
        }
        if (!txCols.has('fee_amount')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN fee_amount REAL;');
        }
        if (!txCols.has('vat_amount')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN vat_amount REAL;');
        }
    }

    // Known accounts table
    const knownAccountCols = await getCols('known_accounts');
    if (knownAccountCols.size === 0) {
        await db.runAsync(`
            CREATE TABLE IF NOT EXISTS known_accounts (
                id TEXT PRIMARY KEY,
                wallet_id TEXT REFERENCES wallets(id) ON DELETE SET NULL,
                provider_id TEXT NOT NULL,
                account_type TEXT NOT NULL DEFAULT 'bank',
                account_number TEXT NOT NULL,
                account_last4 TEXT,
                display_name TEXT NOT NULL,
                masked_identifier TEXT NOT NULL,
                ownership TEXT NOT NULL DEFAULT 'OWN' CHECK (ownership IN ('OWN', 'EXTERNAL')),
                created_at TEXT NOT NULL
            );
        `);
    }
}

/** Initializes schema and legitimate defaults. No transactions or budgets are fabricated. */
export function initDatabase(): Promise<void> {
    if (!initPromise) {
        initPromise = initializeDatabase().catch((error) => {
            initPromise = null;
            throw error;
        });
    }
    return initPromise;
}

async function initializeDatabase(): Promise<void> {
    await connectionOwner.withExclusiveTransaction(async (tx) => {
        const version = await tx.getFirstAsync<{user_version:number}>('PRAGMA user_version;');
        if ((version?.user_version ?? 0) > DATABASE_VERSION) throw Error('This vault was created by a newer BanKoni version. Update the app before opening it.');
        // 1. Create base tables if they don't already exist
        await tx.execAsync(CREATE_TABLES_SQL);
        await tx.execAsync(RECEIPTS_SCHEMA);
        await tx.execAsync(COMPANION_INBOX_SCHEMA);

        // 2. Self-healing check: ensure all columns exist on tables before creating indexes
        await ensureColumnsExist(tx);

        // 3. Create indexes and triggers safely (now that all columns exist)
        await tx.execAsync(INDEXES_AND_TRIGGERS_SQL);

        // 4. Validate single profile constraint
        const userCount = await tx.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) AS count FROM users;',
        );
        if ((userCount?.count ?? 0) > 1) {
            throw new Error(
                'This database contains more than one vault profile. BanKoni stopped to protect your records. Back up the database and resolve the profiles before retrying.',
            );
        }

        // 5. Default wallet & seed data
        await normalizeDefaultWallet(tx);
        await seedInitialData(tx);

        await tx.execAsync(CBE_BALANCE_SCHEMA);
        await tx.execAsync(LEDGER_INTEGRITY_SQL);

        // Version 4 retains event/receive/import provenance and enforces integer ledger balances.
        await tx.execAsync(`PRAGMA user_version = ${DATABASE_VERSION};`);
    });
}

async function seedInitialData(db: SQLite.SQLiteDatabase): Promise<void> {
    // Reinsert missing built-in categories without recreating deleted user data.
    for (const category of defaultCategories) {
        await db.runAsync(
            `INSERT OR IGNORE INTO categories
        (id, name, icon_key, color_key, flow, essential, recurring, is_built_in, is_custom)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                category.id,
                category.name,
                category.iconKey,
                category.colorKey ?? null,
                category.flow,
                category.essential ? 1 : 0,
                category.recurring ? 1 : 0,
                category.isBuiltIn ? 1 : 0,
                category.isCustom ? 1 : 0,
            ],
        );
    }

    // Keep built-in income categories updated with their specific icons if they had the generic 'payments' fallback
    for (const category of defaultIncomeCategories) {
        await db.runAsync(
            `UPDATE categories SET icon_key = ? WHERE id = ? AND is_built_in = 1 AND icon_key = 'payments';`,
            [category.iconKey, category.id],
        );
    }

    const walletCount = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM wallets;',
    );
    if ((walletCount?.count ?? 0) === 0) {
        const now = new Date().toISOString();
        await db.runAsync(
            `INSERT INTO wallets
        (id, name, icon, provider_id, opening_balance, balance, currency, account_number_last4, is_default, is_archived, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, ?);`,
            [
                'wallet-cash-default',
                'Cash',
                'banknote',
                'cash',
                0.0,
                0.0,
                'ETB',
                now,
            ],
        );
    } else {
        await normalizeDefaultWallet(db);
    }

    // Intentionally do not insert dummyTransactions or dummyBudgets here.
}

async function normalizeDefaultWallet(db: SQLite.SQLiteDatabase): Promise<void> {
    const wallets = await db.getAllAsync<Pick<WalletRow, 'id' | 'created_at' | 'is_default'>>(
        'SELECT id, created_at, is_default FROM wallets ORDER BY created_at ASC, id ASC;',
    );
    if (wallets.length === 0) return;

    const defaults = wallets.filter((wallet) => Number(wallet.is_default) === 1);
    if (defaults.length === 1) return;

    const selectedId = defaults[0]?.id ?? wallets[0].id;
    await db.runAsync('UPDATE wallets SET is_default = 0;');
    await db.runAsync('UPDATE wallets SET is_default = 1 WHERE id = ?;', [selectedId]);
}

function mapUser(row: UserRow): User {
    return {
        id: row.id,
        name: row.name,
        email: row.email || undefined,
        isBiometricEnabled: Boolean(row.is_biometric_enabled),
        createdAt: row.created_at,
    };
}

function mapTransaction(row: TransactionRow): Transaction {
    return {
        id: row.id,
        amount: Number(row.amount),
        amountMinor: row.amount_minor ?? Math.round(Number(row.amount) * 100),
        occurredAt: row.occurred_at ?? undefined,
        receivedAt: row.received_at ?? undefined,
        importedAt: row.imported_at ?? undefined,
        dateSource: row.date_source ?? undefined,
        datePrecision: row.date_precision ?? undefined,
        eventDate: row.event_date ?? undefined,
        type: row.type,
        categoryId: row.category_id,
        note: row.note || '',
        date: row.date,
        status: row.status,
        walletId: row.wallet_id,
        currentBalance: row.current_balance == null ? undefined : Number(row.current_balance),
        source: (row.source as 'manual' | 'sms') || 'manual',
        smsReference: row.sms_reference || undefined,
        smsFingerprint: row.sms_fingerprint || undefined,
        smsDetails: row.sms_details ? JSON.parse(row.sms_details) : undefined,
        isTransfer: Boolean(row.is_transfer),
        transferWalletId: row.transfer_wallet_id || undefined,
        subType: (row.sub_type as Transaction['subType']) || 'STANDARD',
        counterparty: row.counterparty || undefined,
        merchantId: row.merchant_id || undefined,
        educationInstitutionId: row.education_institution_id || undefined,
        feeAmount: row.fee_amount != null ? Number(row.fee_amount) : undefined,
        vatAmount: row.vat_amount != null ? Number(row.vat_amount) : undefined,
        createdAt: row.created_at,
    };
}


function mapBudget(row: BudgetRow): Budget {
    return {
        id: row.id,
        categoryId: row.category_id,
        limitAmount: Number(row.limit_amount),
        startDate: row.start_date,
        endDate: row.end_date,
        recurring: normalizeBudgetRecurring(row.recurring),
        alertThreshold:
            row.alert_threshold == null
                ? 0.8
                : Number(row.alert_threshold),
        walletId: row.wallet_id || null,
    };
}

function mapCategory(row: CategoryRow): Category {
    return {
        id: row.id,
        name: row.name,
        iconKey: row.icon_key,
        colorKey: row.color_key || undefined,
        flow: row.flow,
        essential: Boolean(row.essential),
        recurring: Boolean(row.recurring),
        isBuiltIn: Boolean(row.is_built_in),
        isCustom: Boolean(row.is_custom),
    };
}

function mapWallet(row: WalletRow): Wallet {
    return {
        id: row.id,
        name: row.name,
        icon: row.icon,
        providerId: row.provider_id || 'custom',
        ...(row.balance_mode==='cbe_sms' ? {balanceMode:'cbe_sms' as const,...(row.bank_balance_as_of?{bankBalanceAsOf:row.bank_balance_as_of,bankBalanceDateSource:row.bank_balance_date_source}:{})}:{}),
        openingBalance: Number(row.opening_balance ?? 0),
        balance: Number(row.balance ?? 0),
        currency: row.currency,
        accountNumberLast4: row.account_number_last4 || undefined,
        isDefault: Boolean(row.is_default),
        isArchived: Boolean(row.is_archived),
        createdAt: row.created_at,
    };
}

function isValidDate(value: string): boolean {
    return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function assertValidTransaction(tx: Transaction): void {
    if(tx.smsDetails) {
        const d=tx.smsDetails;
        const values=[d.principalMinor,d.feeMinor,d.ledgerMinor,...Object.values(d.chargesMinor)];
        if(d.provider!=='cbe' || d.currency!=='ETB' || d.walletId!==tx.walletId || d.direction!==tx.type || !d.senderId.trim() || !/^\d{4}$/.test(d.accountLast4)
            || values.some(v=>!Number.isSafeInteger(v) || v<0) || d.principalMinor<=0
            || Object.values(d.chargesMinor).reduce((sum,n)=>sum+n,0)!==d.feeMinor
            || d.ledgerMinor!==d.principalMinor+(d.direction==='DEBIT' ? d.feeMinor:0)
            || Math.round(tx.amount*100)!==(tx.subType==='FEE' ? d.feeMinor:d.principalMinor))throw Error('CBE financial provenance disagrees with ledger fields.');
    }
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) {
        throw new Error('Transaction amount must be a finite number greater than zero.');
    }
    const minor = Math.round(tx.amount * 100);
    if (!Number.isSafeInteger(minor) || minor <= 0 || Math.abs(tx.amount * 100 - minor) > 0.00001) throw Error('Transaction amount must be an exact positive number of santim.');
    if (tx.amountMinor != null && tx.amountMinor !== minor) throw Error('Transaction monetary representations disagree.');
    if (tx.datePrecision != null && !['day','minute','second','millisecond'].includes(tx.datePrecision)) throw Error('Invalid date precision.');
    if (tx.datePrecision === 'day' && (!tx.eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(tx.eventDate) || !isValidDate(tx.eventDate) || new Date(tx.eventDate).toISOString().slice(0,10) !== tx.eventDate)) throw Error('A real calendar date is required for date-only transactions.');
    if (tx.datePrecision !== 'day' && tx.eventDate != null) throw Error('Calendar date is only valid for date-only transactions.');
    if (tx.occurredAt != null && tx.occurredAt !== Date.parse(tx.date)) throw Error('Transaction event dates disagree.');
    if (tx.type !== 'CREDIT' && tx.type !== 'DEBIT') {
        throw new Error('Transaction type must be CREDIT or DEBIT.');
    }
    if (tx.status !== 'PENDING' && tx.status !== 'CLEARED') {
        throw new Error('Transaction status must be PENDING or CLEARED.');
    }
    if (!tx.categoryId?.trim() || !tx.walletId?.trim()) {
        throw new Error('A transaction must have a category and wallet.');
    }
    if (!isValidDate(tx.date) || !isValidDate(tx.createdAt)) {
        throw new Error('Transaction dates must be valid dates.');
    }
}

async function assertTransactionReferences(db: SQLite.SQLiteDatabase, tx: Transaction): Promise<void> {
    const category = await db.getFirstAsync<{ flow: string }>(
        'SELECT flow FROM categories WHERE id = ?;',
        [tx.categoryId],
    );
    if (!category) throw new Error('The selected category no longer exists.');
    const expectedFlow = tx.type === 'DEBIT' ? 'EXPENSE' : 'INCOME';
    if (category.flow !== expectedFlow) {
        throw new Error(`A ${tx.type === 'DEBIT' ? 'debit' : 'credit'} must use an ${expectedFlow.toLowerCase()} category.`);
    }

    const wallet = await db.getFirstAsync<{ id: string;provider_id:string;currency:string;account_number_last4:string;is_archived:number }>(
        'SELECT id,provider_id,currency,account_number_last4,is_archived FROM wallets WHERE id = ?;',
        [tx.walletId],
    );
    if (!wallet) throw new Error('The selected wallet no longer exists.');
    if(tx.smsDetails && (wallet.provider_id!=='cbe' || wallet.currency!=='ETB' || wallet.is_archived || wallet.account_number_last4!==tx.smsDetails.accountLast4))throw Error('CBE provider/account/currency authorization no longer matches.');
}

async function assertBudgetCategory(db: SQLite.SQLiteDatabase, budget: Budget): Promise<void> {
    const category = await db.getFirstAsync<{ flow: string }>(
        'SELECT flow FROM categories WHERE id = ?;',
        [budget.categoryId],
    );
    if (!category) throw new Error('The selected budget category no longer exists.');
    if (category.flow !== 'EXPENSE') throw new Error('Budgets must use an expense category.');
}

function balanceEffect(tx: Pick<Transaction, 'amount' | 'type' | 'status'>): number {
    if (tx.status !== 'CLEARED') return 0;
    return tx.type === 'CREDIT' ? tx.amount : -tx.amount;
}

function assertValidBudget(budget: Budget): void {
    if (!Number.isFinite(budget.limitAmount) || budget.limitAmount < 0) {
        throw new Error('Budget limit must be a finite number greater than or equal to zero.');
    }
    if (!budget.categoryId?.trim() || !isValidDate(budget.startDate) || !isValidDate(budget.endDate)) {
        throw new Error('Budget category and dates are required.');
    }
    if (Date.parse(budget.startDate) > Date.parse(budget.endDate)) {
        throw new Error('Budget end date must not be earlier than its start date.');
    }
    if (
        budget.alertThreshold != null &&
        (!Number.isFinite(budget.alertThreshold) || budget.alertThreshold < 0 || budget.alertThreshold > 1)
    ) {
        throw new Error('Budget alert threshold must be between 0 and 1.');
    }
}

// Single-profile vault repository

export async function getActiveUserDB(): Promise<{ user: User; pinHash: string } | null> {
    const db = await getDatabase();
    const count = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM users;');
    if ((count?.count ?? 0) > 1) {
        throw new Error('Multiple vault profiles were found. The database must be repaired before unlocking.');
    }

    const row = await db.getFirstAsync<UserRow>('SELECT * FROM users LIMIT 1;');
    if (!row) return null;
    return { user: mapUser(row), pinHash: row.pin_hash };
}

export async function saveUserDB(user: User, pinHash: string): Promise<void> {
    await withExclusiveTransaction(async (tx) => {
        const count = await tx.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM users;');
        if ((count?.count ?? 0) > 0) {
            throw new Error('A local vault already exists on this installation. Unlock it instead of creating another profile.');
        }

        await tx.runAsync(
            `INSERT INTO users (id, name, email, pin_hash, is_biometric_enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?);`,
            [
                user.id,
                user.name.trim(),
                user.email?.trim() || null,
                pinHash,
                user.isBiometricEnabled ? 1 : 0,
                user.createdAt,
            ],
        );
    });
}

export async function updateUserPinHashDB(userId: string, pinHash: string): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        const result = await db.runAsync('UPDATE users SET pin_hash = ? WHERE id = ?;', [pinHash, userId]);
        if (result.changes !== 1) throw new Error('The stored vault profile could not be updated.');
    });
}

export async function setBiometricEnabledDB(userId: string, enabled: boolean): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        const result = await db.runAsync(
            'UPDATE users SET is_biometric_enabled = ? WHERE id = ?;',
            [enabled ? 1 : 0, userId],
        );
        if (result.changes !== 1) throw new Error('The vault profile could not be updated.');
    });
}
export async function updateUserProfileDB(userId: string, name: string, email?: string,): Promise<void> {
    const cleanName = name.trim();
    const cleanEmail = email?.trim() || null;

    if (!cleanName) {
        throw new Error('Name is required.');
    }

    if (
        cleanEmail &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
        throw new Error('Enter a valid email address.');
    }

    await withExclusiveTransaction(async (db) => {
        const result = await db.runAsync(
            'UPDATE users SET name = ?, email = ? WHERE id = ?;',
            [cleanName, cleanEmail, userId],
        );

        if (result.changes !== 1) {
            throw new Error('The local vault profile could not be updated.');
        }
    });
}

// Local PIN attempt controls. These slow online guessing through the app; they
// do not replace database encryption or protect a copied hash from offline guesses.

export interface PinAttemptState {
    failedAttempts: number;
    lockoutUntilMs: number;
}

export async function getPinAttemptStateDB(): Promise<PinAttemptState> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ failed_pin_attempts: number; lockout_until_ms: number }>(
        'SELECT failed_pin_attempts, lockout_until_ms FROM auth_security WHERE id = 1;',
    );
    return {
        failedAttempts: Number(row?.failed_pin_attempts ?? 0),
        lockoutUntilMs: Number(row?.lockout_until_ms ?? 0),
    };
}

export async function recordFailedPinAttemptDB(): Promise<PinAttemptState> {
    return withExclusiveTransaction(async (db) => {
        const row = await db.getFirstAsync<{ failed_pin_attempts: number; lockout_until_ms: number }>(
            'SELECT failed_pin_attempts, lockout_until_ms FROM auth_security WHERE id = 1;',
        );
        const failedAttempts = Number(row?.failed_pin_attempts ?? 0) + 1;
        let lockoutUntilMs = Number(row?.lockout_until_ms ?? 0);

        if (failedAttempts >= 5) {
            const exponent = Math.min(failedAttempts - 5, 5);
            const cooldownMs = Math.min(30_000 * (2 ** exponent), 15 * 60_000);
            lockoutUntilMs = Date.now() + cooldownMs;
        } else {
            lockoutUntilMs = 0;
        }

        await db.runAsync(
            'UPDATE auth_security SET failed_pin_attempts = ?, lockout_until_ms = ? WHERE id = 1;',
            [failedAttempts, lockoutUntilMs],
        );
        return { failedAttempts, lockoutUntilMs };
    });
}

export async function resetPinAttemptStateDB(): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            'UPDATE auth_security SET failed_pin_attempts = 0, lockout_until_ms = 0 WHERE id = 1;',
        );
    });
}

// Transactions

export async function getTransactionsDB(): Promise<Transaction[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TransactionRow>(
        'SELECT * FROM transactions ORDER BY occurred_at DESC, imported_at DESC, id DESC;',
    );
    return rows.map(mapTransaction);
}

export async function insertTransactionDB(tx: Transaction, smsMessageKey?: string): Promise<void> {
    assertValidTransaction(tx);
    await withExclusiveTransaction(async (db) => {
        await assertTransactionReferences(db, tx);
        const account=await db.getFirstAsync<{provider_id:string}>('SELECT provider_id FROM wallets WHERE id=?',[tx.walletId]);
        if(tx.source==='sms' && account?.provider_id==='cbe')throw Error('CBE SMS writes require the shared validated import plan.');

        if (smsMessageKey && await db.getFirstAsync('SELECT message_key FROM sms_import_receipts WHERE message_key=?;', [smsMessageKey])) {
            throw new Error('This message has already been imported.');
        }
        // Pre-validate duplicate constraints with descriptive errors
        if (tx.smsReference) {
            const existing = await db.getFirstAsync<{ id: string }>(
                'SELECT id FROM transactions WHERE sms_reference = ? COLLATE NOCASE AND wallet_id = ? AND type = ?;',
                [tx.smsReference, tx.walletId, tx.type],
            );
            if (existing) {
                throw new Error(`A transaction with reference "${tx.smsReference}" has already been imported.`);
            }
        }
        if (tx.smsFingerprint) {
            const existing = await db.getFirstAsync<{ id: string }>(
                'SELECT id FROM transactions WHERE sms_fingerprint = ?;',
                [tx.smsFingerprint],
            );
            if (existing) {
                throw new Error('This transaction appears to be a duplicate of an existing record.');
            }
        }

        const statement = transactionInsert(tx);
        await db.runAsync(statement.sql, statement.params);

        if (smsMessageKey) await db.runAsync('INSERT INTO sms_import_receipts(message_key, transaction_id, created_at) VALUES (?, ?, ?);',
            [smsMessageKey, tx.id, tx.createdAt]);
        const delta = balanceEffect(tx);
        if (delta !== 0) {
            const walletUpdate = await db.runAsync(
                'UPDATE wallets SET balance = balance + ? WHERE id = ?;',
                [delta, tx.walletId],
            );
            if (walletUpdate.changes !== 1) throw new Error('The selected wallet no longer exists.');
        }
    });
}

/**
 * Checks if a transaction with the given reference or fingerprint already exists.
 * Used for pre-validation in the SMS review UI.
 */
export async function checkSmsDuplicateDB(
    reference?: string,
    fingerprint?: string,
    walletId?: string,
    type?: 'CREDIT' | 'DEBIT',
): Promise<{ isDuplicate: boolean; matchedBy?: 'reference' | 'fingerprint'; transactionId?: string }> {
    if (!reference && !fingerprint) {
        return { isDuplicate: false };
    }
    const db = await getDatabase();
    if (reference) {
        const row = await db.getFirstAsync<{ id: string }>(
            'SELECT id FROM transactions WHERE sms_reference = ? COLLATE NOCASE AND (? IS NULL OR wallet_id = ?) AND (? IS NULL OR type = ?);',
            [reference, walletId ?? null, walletId ?? null, type ?? null, type ?? null],
        );
        if (row) {
            return { isDuplicate: true, matchedBy: 'reference', transactionId: row.id };
        }
    }
    if (fingerprint) {
        const row = await db.getFirstAsync<{ id: string }>(
            'SELECT id FROM transactions WHERE sms_fingerprint = ?;',
            [fingerprint],
        );
        if (row) {
            return { isDuplicate: true, matchedBy: 'fingerprint', transactionId: row.id };
        }
    }
    return { isDuplicate: false };
}

export async function updateTransactionDB(
    id: string,
    updated: Partial<Omit<Transaction, 'id' | 'createdAt'>>,
): Promise<void> {
    const fields: string[] = [];
    const values: Array<string | number | null> = [];

    if (updated.amount !== undefined) { fields.push('amount = ?'); values.push(updated.amount); }
    if (updated.type !== undefined) { fields.push('type = ?'); values.push(updated.type); }
    if (updated.categoryId !== undefined) { fields.push('category_id = ?'); values.push(updated.categoryId); }
    if (updated.note !== undefined) { fields.push('note = ?'); values.push(updated.note); }
    if (updated.date !== undefined) { fields.push('date = ?', 'date_source = ?', 'date_precision = ?', 'event_date = ?'); values.push(updated.date, 'manual', updated.datePrecision ?? 'second', updated.eventDate ?? null); }
    if (updated.status !== undefined) { fields.push('status = ?'); values.push(updated.status); }
    if (updated.walletId !== undefined) { fields.push('wallet_id = ?'); values.push(updated.walletId); }
    if (updated.currentBalance !== undefined) { fields.push('current_balance = ?'); values.push(updated.currentBalance); }
    if (updated.isTransfer !== undefined) { fields.push('is_transfer = ?'); values.push(updated.isTransfer ? 1 : 0); }
    if (updated.transferWalletId !== undefined) { fields.push('transfer_wallet_id = ?'); values.push(updated.transferWalletId || null); }
    if (updated.subType !== undefined) { fields.push('sub_type = ?'); values.push(updated.subType); }
    if (updated.counterparty !== undefined) { fields.push('counterparty = ?'); values.push(updated.counterparty || null); }
    if (updated.merchantId !== undefined) { fields.push('merchant_id = ?'); values.push(updated.merchantId || null); }
    if (updated.educationInstitutionId !== undefined) { fields.push('education_institution_id = ?'); values.push(updated.educationInstitutionId || null); }
    if (updated.feeAmount !== undefined) { fields.push('fee_amount = ?'); values.push(updated.feeAmount ?? null); }
    if (updated.vatAmount !== undefined) { fields.push('vat_amount = ?'); values.push(updated.vatAmount ?? null); }
    if (fields.length === 0) return;

    await withExclusiveTransaction(async (db) => {
        const oldRow = await db.getFirstAsync<TransactionRow>(
            'SELECT * FROM transactions WHERE id = ?;',
            [id],
        );
        if (!oldRow) throw new Error('Transaction not found. It may already have been deleted.');

        const oldTransaction = mapTransaction(oldRow);
        const nextTransaction: Transaction = { ...oldTransaction, ...updated,
            amountMinor: updated.amount != null ? Math.round(updated.amount * 100) : oldTransaction.amountMinor,
            dateSource: updated.date != null ? 'manual' : oldTransaction.dateSource,
            datePrecision: updated.date != null ? (updated.datePrecision ?? 'second') : oldTransaction.datePrecision,
            eventDate: updated.date != null ? updated.eventDate : oldTransaction.eventDate,
            occurredAt: updated.date != null ? Date.parse(updated.date) : oldTransaction.occurredAt };
        assertValidTransaction(nextTransaction);
        await assertTransactionReferences(db, nextTransaction);

        const oldDelta = balanceEffect(oldTransaction);
        const newDelta = balanceEffect(nextTransaction);
        if (oldDelta !== 0) {
            const result = await db.runAsync(
                'UPDATE wallets SET balance = balance - ? WHERE id = ?;',
                [oldDelta, oldTransaction.walletId],
            );
            if (result.changes !== 1) throw new Error('The original wallet could not be reconciled.');
        }
        if (newDelta !== 0) {
            const result = await db.runAsync(
                'UPDATE wallets SET balance = balance + ? WHERE id = ?;',
                [newDelta, nextTransaction.walletId],
            );
            if (result.changes !== 1) throw new Error('The selected wallet no longer exists.');
        }

        values.push(id);
        await db.runAsync(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ?;`, values);
    });
}

export async function deleteTransactionDB(id: string): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        const row = await db.getFirstAsync<TransactionRow>(
            'SELECT * FROM transactions WHERE id = ?;',
            [id],
        );
        if (!row) return;

        const transaction = mapTransaction(row);
        const delta = balanceEffect(transaction);
        if (delta !== 0) {
            const result = await db.runAsync(
                'UPDATE wallets SET balance = balance - ? WHERE id = ?;',
                [delta, transaction.walletId],
            );
            if (result.changes !== 1) throw new Error('The wallet balance could not be reconciled.');
        }
        await db.runAsync('DELETE FROM transactions WHERE id = ?;', [id]);
    });
}

function normalizeBudgetRecurring(value: unknown): NonNullable<Budget['recurring']> {
    switch (value) {
        case 'none':
        case 'daily':
        case 'weekly':
        case 'biweekly':
        case 'monthly':
        case 'yearly':
            return value;

        default:
            return 'monthly';
    }
}
// Budgets
export async function getBudgetsDB(): Promise<Budget[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<BudgetRow>('SELECT * FROM budgets ORDER BY start_date DESC;');
    return rows.map(mapBudget);
}

export async function insertBudgetDB(budget: Budget): Promise<void> {
    assertValidBudget(budget);
    await withExclusiveTransaction(async (db) => {
        await assertBudgetCategory(db, budget);
        await db.runAsync(
            `INSERT INTO budgets (id, category_id, limit_amount, start_date, end_date, recurring, alert_threshold, wallet_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                budget.id,
                budget.categoryId,
                budget.limitAmount,
                budget.startDate,
                budget.endDate,
                budget.recurring || 'monthly',
                budget.alertThreshold ?? 0.8,
                budget.walletId || null,
            ],
        );
    });
}

export async function updateBudgetDB(
    id: string,
    updated: Partial<Omit<Budget, 'id'>>,
): Promise<void> {
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    if (updated.categoryId !== undefined) { fields.push('category_id = ?'); values.push(updated.categoryId); }
    if (updated.limitAmount !== undefined) { fields.push('limit_amount = ?'); values.push(updated.limitAmount); }
    if (updated.startDate !== undefined) { fields.push('start_date = ?'); values.push(updated.startDate); }
    if (updated.endDate !== undefined) { fields.push('end_date = ?'); values.push(updated.endDate); }
    if (updated.recurring !== undefined) { fields.push('recurring = ?'); values.push(updated.recurring); }
    if (updated.alertThreshold !== undefined) { fields.push('alert_threshold = ?'); values.push(updated.alertThreshold); }
    if (updated.walletId !== undefined) { fields.push('wallet_id = ?'); values.push(updated.walletId || null); }
    if (fields.length === 0) return;

    await withExclusiveTransaction(async (db) => {
        const currentRow = await db.getFirstAsync<BudgetRow>('SELECT * FROM budgets WHERE id = ?;', [id]);
        if (!currentRow) throw new Error('Budget not found. It may already have been deleted.');
        const next = { ...mapBudget(currentRow), ...updated };
        assertValidBudget(next);
        await assertBudgetCategory(db, next);
        values.push(id);
        await db.runAsync(`UPDATE budgets SET ${fields.join(', ')} WHERE id = ?;`, values);
    });
}

export async function deleteBudgetDB(id: string): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        await db.runAsync('DELETE FROM budgets WHERE id = ?;', [id]);
    });
}

// Categories and wallets

export async function getCategoriesDB(): Promise<Category[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CategoryRow>(
        'SELECT * FROM categories ORDER BY is_built_in DESC, name ASC;',
    );
    return rows.map(mapCategory);
}

export async function insertCategoryDB(category: Category): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            `INSERT INTO categories
      (id, name, icon_key, color_key, flow, essential, recurring, is_built_in, is_custom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                category.id,
                category.name.trim(),
                category.iconKey,
                category.colorKey ?? null,
                category.flow,
                category.essential ? 1 : 0,
                category.recurring ? 1 : 0,
                category.isBuiltIn ? 1 : 0,
                category.isCustom ? 1 : 0,
            ],
        );
    });
}

export async function deleteCategoryDB(id: string): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        const category = await db.getFirstAsync<{ is_built_in: number }>(
            'SELECT is_built_in FROM categories WHERE id = ?;',
            [id],
        );
        if (!category) return;
        if (Boolean(category.is_built_in)) throw new Error('Built-in categories cannot be deleted.');

        const txCount = await db.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) AS count FROM transactions WHERE category_id = ?;', [id],
        );
        const budgetCount = await db.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) AS count FROM budgets WHERE category_id = ?;', [id],
        );
        if ((txCount?.count ?? 0) > 0 || (budgetCount?.count ?? 0) > 0) {
            throw new Error('This category is used by transactions or budgets. Reassign those records before deleting it.');
        }
        await db.runAsync('DELETE FROM categories WHERE id = ?;', [id]);
    });
}

export async function getWalletsDB(includeArchived: boolean = true): Promise<Wallet[]> {
    const db = await getDatabase();
    const query = includeArchived
        ? `SELECT wallets.*, ${ledgerBalance()} AS balance, (SELECT observed_at FROM (${cbeBalanceEvidence()}) e ORDER BY observed_at DESC,received_at DESC,id DESC LIMIT 1) AS bank_balance_as_of, (SELECT date_source FROM (${cbeBalanceEvidence()}) e ORDER BY observed_at DESC,received_at DESC,id DESC LIMIT 1) AS bank_balance_date_source FROM wallets ORDER BY is_archived ASC, is_default DESC, created_at ASC;`
        : `SELECT wallets.*, ${ledgerBalance()} AS balance, (SELECT observed_at FROM (${cbeBalanceEvidence()}) e ORDER BY observed_at DESC,received_at DESC,id DESC LIMIT 1) AS bank_balance_as_of, (SELECT date_source FROM (${cbeBalanceEvidence()}) e ORDER BY observed_at DESC,received_at DESC,id DESC LIMIT 1) AS bank_balance_date_source FROM wallets WHERE is_archived = 0 ORDER BY is_default DESC, created_at ASC;`;
    const rows = await db.getAllAsync<WalletRow>(query);
    return rows.map(mapWallet);
}

export async function insertWalletDB(wallet: Wallet): Promise<void> {
    if (!wallet.name.trim()) throw new Error('Wallet name is required.');
    if (!wallet.currency.trim()) throw new Error('Wallet currency is required.');
    if (!Number.isFinite(wallet.openingBalance)) throw new Error('Opening balance must be a finite number.');
    if (!Number.isFinite(wallet.balance)) throw new Error('Wallet balance must be a finite number.');

    await withExclusiveTransaction(async (db) => {
        if (wallet.isDefault) await db.runAsync('UPDATE wallets SET is_default = 0;');
        await db.runAsync(
            `INSERT INTO wallets
        (id, name, icon, provider_id, opening_balance, balance, currency, account_number_last4, is_default, is_archived, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                wallet.id,
                wallet.name.trim(),
                wallet.icon,
                wallet.providerId || 'custom',
                wallet.openingBalance,
                wallet.balance,
                wallet.currency.trim().toUpperCase(),
                wallet.accountNumberLast4?.trim() || null,
                wallet.isDefault ? 1 : 0,
                wallet.isArchived ? 1 : 0,
                wallet.createdAt,
            ],
        );
        if(wallet.balanceMode==='cbe_sms') {
            if(wallet.providerId!=='cbe' || wallet.currency!=='ETB' || !wallet.accountNumberLast4)throw Error('CBE balance mode requires a matching CBE ETB account ending.');
            await db.runAsync("UPDATE wallets SET balance_mode='cbe_sms' WHERE id=?",[wallet.id]);
        }
    });
}

export async function updateWalletDB(
    id: string,
    updated: Partial<Omit<Wallet, 'id' | 'createdAt'>>,
): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        const current = await db.getFirstAsync<WalletRow>('SELECT * FROM wallets WHERE id = ?;', [id]);
        if (!current) throw new Error('Wallet not found.');

        const mapped = mapWallet(current);

        const newName = updated.name !== undefined ? updated.name.trim() : mapped.name;
        if (!newName) throw new Error('Wallet name is required.');

        const newCurrency = updated.currency !== undefined ? updated.currency.trim().toUpperCase() : mapped.currency;
        if (!newCurrency) throw new Error('Wallet currency is required.');

        const newProviderId = updated.providerId !== undefined ? updated.providerId : mapped.providerId;
        const newIcon = updated.icon !== undefined ? updated.icon : mapped.icon;
        const newLast4 = updated.accountNumberLast4 !== undefined ? (updated.accountNumberLast4?.trim() || null) : (mapped.accountNumberLast4 || null);
        const newIsArchived = updated.isArchived !== undefined ? updated.isArchived : mapped.isArchived;

        // If opening balance changed: recalculate balance strictly using the invariant!
        let newOpeningBalance = mapped.openingBalance;
        let newBalance = mapped.balance;

        if (updated.openingBalance !== undefined) {
            if (!Number.isFinite(updated.openingBalance)) throw new Error('Opening balance must be a finite number.');
            newOpeningBalance = updated.openingBalance;

            const netRow = await db.getFirstAsync<{ net: number | null }>(`
                SELECT SUM(CASE
                    WHEN status <> 'CLEARED' THEN 0
                    WHEN type = 'CREDIT' THEN amount
                    ELSE -amount
                END) AS net
                FROM transactions
                WHERE wallet_id = ?;
            `, [id]);
            const net = Number(netRow?.net ?? 0);
            newBalance = newOpeningBalance + net;
        }

        if (updated.isDefault) {
            await db.runAsync('UPDATE wallets SET is_default = 0;');
        }

        const isDefaultVal = updated.isDefault !== undefined ? (updated.isDefault ? 1 : 0) : current.is_default;

        await db.runAsync(
            `UPDATE wallets
             SET name = ?, icon = ?, provider_id = ?, opening_balance = ?, balance = ?, currency = ?, account_number_last4 = ?, is_default = ?, is_archived = ?
             WHERE id = ?;`,
            [
                newName,
                newIcon,
                newProviderId,
                newOpeningBalance,
                newBalance,
                newCurrency,
                newLast4,
                isDefaultVal,
                newIsArchived ? 1 : 0,
                id,
            ],
        );
        if(updated.balanceMode!==undefined) {
            if(!['ledger','cbe_sms'].includes(updated.balanceMode) || (updated.balanceMode==='cbe_sms' && (newProviderId!=='cbe' || newCurrency!=='ETB' || !newLast4)))throw Error('Choose an owned CBE ETB account ending for bank-reported balance.');
            await db.runAsync('UPDATE wallets SET balance_mode=? WHERE id=?',[updated.balanceMode,id]);
        }
    });
}

export async function setDefaultWalletDB(id: string): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        const wallet = await db.getFirstAsync<{ id: string; is_archived: number }>('SELECT id, is_archived FROM wallets WHERE id = ?;', [id]);
        if (!wallet) throw new Error('Wallet not found.');
        if (Boolean(wallet.is_archived)) throw new Error('Cannot set an archived wallet as default.');

        await db.runAsync('UPDATE wallets SET is_default = 0;');
        await db.runAsync('UPDATE wallets SET is_default = 1 WHERE id = ?;', [id]);
    });
}

export async function archiveWalletDB(id: string, isArchived: boolean): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        const wallet = await db.getFirstAsync<{ is_default: number }>('SELECT is_default FROM wallets WHERE id = ?;', [id]);
        if (!wallet) throw new Error('Wallet not found.');
        if (isArchived && Boolean(wallet.is_default)) {
            throw new Error('The default wallet cannot be archived. Set another wallet as default first.');
        }

        await db.runAsync('UPDATE wallets SET is_archived = ? WHERE id = ?;', [isArchived ? 1 : 0, id]);
    });
}

export async function deleteWalletDB(id: string): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        const wallet = await db.getFirstAsync<{ is_default: number }>(
            'SELECT is_default FROM wallets WHERE id = ?;', [id],
        );
        if (!wallet) return;
        if (Boolean(wallet.is_default)) throw new Error('The default wallet cannot be deleted. Set another wallet as default first.');

        const count = await db.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) AS count FROM transactions WHERE wallet_id = ?;', [id],
        );
        if ((count?.count ?? 0) > 0) {
            throw new Error('This wallet contains transactions. Archive it instead, or delete its transactions before removing it.');
        }
        await db.runAsync('DELETE FROM wallets WHERE id = ?;', [id]);
    });
}

// JSON export. The export deliberately excludes the user's PIN hash.

export async function exportDatabaseToJSON(settings?: UserPreferencesPayload): Promise<ExportDataPayload> {
    return withExclusiveTransaction(async db => {
    const userRow = await db.getFirstAsync<UserRow>('SELECT * FROM users LIMIT 1;');
    const wallets = (await db.getAllAsync<WalletRow>('SELECT * FROM wallets;')).map(mapWallet);
    const categories = (await db.getAllAsync<CategoryRow>('SELECT * FROM categories;')).map(mapCategory);
    const budgets = (await db.getAllAsync<BudgetRow>('SELECT * FROM budgets;')).map(mapBudget);
    const transactions = (await db.getAllAsync<TransactionRow>('SELECT * FROM transactions;')).map(mapTransaction);

    const etbWalletIds = new Set(wallets.filter((wallet) => wallet.currency === 'ETB').map((wallet) => wallet.id));
    const etbClearedTransactions = transactions.filter(
        (transaction) => transaction.status === 'CLEARED' && etbWalletIds.has(transaction.walletId),
    );
    const totalIncome = etbClearedTransactions
        .filter(isEarnedIncome)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    const totalExpenses = etbClearedTransactions
        .filter(isPersonalSpending)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    const totalBalance = wallets
        .filter((wallet) => wallet.currency === 'ETB')
        .reduce((sum, wallet) => sum + wallet.balance, 0);

    return {
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        user: userRow ? mapUser(userRow) : null,
        wallets,
        categories,
        budgets,
        transactions,
        summary: {
            totalTransactions: transactions.length,
            totalBalance,
            totalIncome,
            totalExpenses,
            currency: 'ETB',
        },
        settings,
        financialTables: await exportFinancialTables(db),
    };
    });
}

export interface ImportSummary {
    restoredWallets: number;
    restoredCategories: number;
    restoredBudgets: number;
    restoredTransactions: number;
    userProfile?: { name: string; email?: string } | null;
    settings?: UserPreferencesPayload;
}

export async function importDatabaseFromJSON(payload: ExportDataPayload): Promise<ImportSummary> {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid backup file: Not a valid JSON document.');
    }
    if (!Array.isArray(payload.wallets) || !Array.isArray(payload.categories) || !Array.isArray(payload.transactions)) {
        throw new Error('Invalid backup file: Missing core financial tables (wallets, categories, or transactions).');
    }
    if(payload.version==='3.0.0')return withExclusiveTransaction(async db=>{
        const current=await exportFinancialTables(db);
        const merged=mergeSelectedTables(current,payload);
        await restoreFinancialTables(db,merged);
        for(const row of await db.getAllAsync<TransactionRow>('SELECT * FROM transactions;'))assertValidTransaction(mapTransaction(row));
        for(const row of await db.getAllAsync<BudgetRow>('SELECT * FROM budgets;'))assertValidBudget(mapBudget(row));
        return {restoredWallets:payload.wallets.length,restoredCategories:payload.categories.length,restoredBudgets:payload.budgets.length,restoredTransactions:payload.transactions.length,settings:payload.selection?.preferences?payload.settings:undefined};
    });
    if (!payload.wallets.length) throw Error('A backup must contain at least one wallet.');

    if (payload.version === '2.0.0') {
        return withExclusiveTransaction(async db => {
            const legacyLedger = !!payload.financialTables?.transactions.some(row => !['amount_minor','occurred_at','received_at','imported_at','date_source'].some(key => key in row));
            if (legacyLedger && payload.wallets.some(wallet => payload.financialTables?.wallets.find(row=>row.id===wallet.id)?.balance !== wallet.balance)) throw Error('Backup wallet views disagree.');
            await restoreFinancialTables(db, payload.financialTables);
            for (const row of await db.getAllAsync<TransactionRow>('SELECT * FROM transactions;')) assertValidTransaction(mapTransaction(row));
            for (const row of await db.getAllAsync<BudgetRow>('SELECT * FROM budgets;')) assertValidBudget(mapBudget(row));
            const snapshot = payload.financialTables!;
            // Core views are included for portability, but may not disagree with
            // the full snapshot. Reject edited/partial files instead of guessing.
            const canonical = (items: object[]) => JSON.stringify(items.map(item => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)))).sort((a, b) => String(a.id).localeCompare(String(b.id))));
            const normalizeMetadata = (transaction: Transaction): Transaction => ({ ...transaction,
                amountMinor: transaction.amountMinor ?? Math.round(transaction.amount * 100),
                occurredAt: transaction.occurredAt ?? Date.parse(transaction.date),
                importedAt: transaction.importedAt ?? Date.parse(transaction.createdAt), datePrecision: transaction.datePrecision, eventDate: transaction.eventDate, dateSource: transaction.dateSource ?? 'legacy' });
            const pairs: [object[], object[]][] = [
                [payload.transactions.map(normalizeMetadata), (await db.getAllAsync<TransactionRow>('SELECT * FROM transactions;')).map(mapTransaction).map(normalizeMetadata)],
                [legacyLedger ? payload.wallets.map(wallet=>({ ...wallet,balance:(Math.round(wallet.openingBalance*100)+payload.transactions.filter(t=>t.walletId===wallet.id && t.status==='CLEARED').reduce((sum,t)=>sum+(t.type==='CREDIT' ? 1 : -1)*Math.round(t.amount*100),0))/100 })) : payload.wallets, (await db.getAllAsync<WalletRow>('SELECT * FROM wallets;')).map(mapWallet)],
                [payload.budgets, (await db.getAllAsync<BudgetRow>('SELECT * FROM budgets;')).map(mapBudget)],
                [payload.categories, (await db.getAllAsync<CategoryRow>('SELECT * FROM categories;')).map(mapCategory)],
            ];
            if (pairs.some(([core, full]) => !Array.isArray(core) || canonical(core) !== canonical(full))) throw Error('Backup core records disagree with its financial snapshot.');
            if (payload.user?.name) await db.runAsync('UPDATE users SET name=?, email=?;', [payload.user.name.trim(), payload.user.email?.trim() || null]);
            return { restoredWallets:snapshot.wallets.length, restoredCategories:snapshot.categories.length, restoredBudgets:snapshot.budgets.length, restoredTransactions:snapshot.transactions.length, settings:payload.settings };
        });
    }
    if (payload.version !== '1.0.0') throw Error('This backup version is not supported. Update BanKoni or choose a compatible backup.');

    return withExclusiveTransaction(async (db) => {
        // Version 1 lacks relationship snapshots. Clear dependent records safely
        // instead of leaving links pointing at the replaced ledger.
        await db.execAsync('PRAGMA defer_foreign_keys=ON;');
        for (const table of [...FINANCIAL_TABLES].reverse()) {
            if (!['categories','wallets','transactions','budgets'].includes(table)) await db.runAsync(`DELETE FROM ${table};`);
        }
        // 1. Delete transactions and budgets first to avoid foreign key / trigger blocks
        await db.runAsync('DELETE FROM transactions;');
        await db.runAsync('DELETE FROM budgets;');

        // 2. Clear default flag on wallets, then delete all wallets
        await db.runAsync('UPDATE wallets SET is_default = 0;');
        await db.runAsync('DELETE FROM wallets;');

        // 3. Clear existing custom categories (built-in categories remain protected)
        await db.runAsync('DELETE FROM categories WHERE is_built_in = 0;');

        // 4. Restore categories
        let restoredCategoriesCount = 0;
        const validCategoryIds = new Set<string>();

        const existingCatRows = await db.getAllAsync<{ id: string }>('SELECT id FROM categories;');
        existingCatRows.forEach((r) => validCategoryIds.add(r.id));

        for (const cat of payload.categories) {
            const flow = cat.flow === 'INCOME' ? 'INCOME' : 'EXPENSE';
            const isBuiltIn = cat.isCustom ? 0 : 1;
            const isCustom = cat.isCustom ? 1 : 0;
            const essential = cat.essential ? 1 : 0;
            const recurring = cat.recurring ? 1 : 0;

            await db.runAsync(
                `INSERT INTO categories (id, name, icon_key, color_key, flow, essential, recurring, is_built_in, is_custom)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name,
                   icon_key = excluded.icon_key,
                   color_key = excluded.color_key,
                   flow = excluded.flow;`,
                [
                    cat.id,
                    cat.name.trim(),
                    cat.iconKey || 'HelpCircle',
                    cat.colorKey || null,
                    flow,
                    essential,
                    recurring,
                    isBuiltIn,
                    isCustom,
                ],
            );
            validCategoryIds.add(cat.id);
            restoredCategoriesCount++;
        }

        // 5. Restore wallets
        let restoredWalletsCount = 0;
        const validWalletIds = new Set<string>();
        let hasDefault = false;

        for (const w of payload.wallets) {
            const isDefault = Boolean(w.isDefault && !hasDefault);
            if (isDefault) hasDefault = true;

            await db.runAsync(
                `INSERT INTO wallets (id, name, icon, provider_id, opening_balance, balance, currency, account_number_last4, is_default, is_archived, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
                [
                    w.id,
                    w.name.trim(),
                    w.icon || 'Wallet',
                    w.providerId || 'custom',
                    Number(w.openingBalance) || 0,
                    Number(w.balance) || 0,
                    (w.currency || 'ETB').trim().toUpperCase(),
                    w.accountNumberLast4?.trim() || null,
                    isDefault ? 1 : 0,
                    w.isArchived ? 1 : 0,
                    w.createdAt || new Date().toISOString(),
                ],
            );
            validWalletIds.add(w.id);
            restoredWalletsCount++;
        }

        // Ensure at least one default wallet
        if (!hasDefault && payload.wallets.length > 0) {
            await db.runAsync('UPDATE wallets SET is_default = 1 WHERE id = ?;', [payload.wallets[0].id]);
        }

        // 6. Restore budgets
        let restoredBudgetsCount = 0;
        if (Array.isArray(payload.budgets)) {
            for (const b of payload.budgets) {
                assertValidBudget(b);
                if (!validCategoryIds.has(b.categoryId) || b.walletId && !validWalletIds.has(b.walletId)) throw Error('Backup budget refers to a missing category or wallet.');
                const walletId = b.walletId || null;

                await db.runAsync(
                    `INSERT INTO budgets (id, category_id, limit_amount, start_date, end_date, recurring, alert_threshold, wallet_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
                    [
                        b.id,
                        b.categoryId,
                        Number(b.limitAmount) || 0,
                        b.startDate,
                        b.endDate,
                        b.recurring || 'monthly',
                        b.alertThreshold ?? 0.8,
                        walletId,
                    ],
                );
                restoredBudgetsCount++;
            }
        }

        // 7. Restore transactions
        let restoredTransactionsCount = 0;
        for (const tx of payload.transactions) {
            if (!validCategoryIds.has(tx.categoryId) || !validWalletIds.has(tx.walletId)) {
                throw Error('Backup transaction refers to a missing wallet or category.');
            }

            assertValidTransaction(tx);
            await assertTransactionReferences(db, tx);
            const command = transactionInsert(tx);
            await db.runAsync(command.sql, command.params);
            restoredTransactionsCount++;
        }

        // 8. Reconcile wallet balances with actual transaction net
        for (const walletId of validWalletIds) {
            const row = await db.getFirstAsync<{ opening_balance: number }>(
                'SELECT opening_balance FROM wallets WHERE id = ?;',
                [walletId],
            );
            const opening = Number(row?.opening_balance ?? 0);
            const netRow = await db.getFirstAsync<{ net: number | null }>(`
                SELECT SUM(CASE
                    WHEN status <> 'CLEARED' THEN 0
                    WHEN type = 'CREDIT' THEN amount
                    ELSE -amount
                END) AS net
                FROM transactions
                WHERE wallet_id = ?;
            `, [walletId]);
            const net = Number(netRow?.net ?? 0);
            await db.runAsync(
                'UPDATE wallets SET balance = ? WHERE id = ?;',
                [opening + net, walletId],
            );
        }

        // 9. Update user profile name and email (preserves device PIN completely)
        if (payload.user?.name) {
            const cleanName = payload.user.name.trim();
            const cleanEmail = payload.user.email?.trim() || null;
            await db.runAsync(
                'UPDATE users SET name = ?, email = ? WHERE id = (SELECT id FROM users LIMIT 1);',
                [cleanName, cleanEmail],
            );
        }

        return {
            restoredWallets: restoredWalletsCount,
            restoredCategories: restoredCategoriesCount,
            restoredBudgets: restoredBudgetsCount,
            restoredTransactions: restoredTransactionsCount,
            userProfile: payload.user ? { name: payload.user.name, email: payload.user.email } : null,
            settings: payload.settings,
        };
    });
}

// ---------------------------------------------------------------------------
// Financial Relationships, Merchants, Education, Bill, Telecom & Commitments
// ---------------------------------------------------------------------------

interface TransferRow {
    id: string;
    from_transaction_id: string | null;
    to_transaction_id: string | null;
    from_wallet_id: string;
    to_wallet_id: string;
    amount: number;
    fee_amount: number | null;
    fee_transaction_id: string | null;
    note: string | null;
    created_at: string;
}

interface RefundAllocationRow {
    id: string;
    refund_transaction_id: string;
    original_transaction_id: string | null;
    allocated_amount: number;
    notes: string | null;
    created_at: string;
}

interface SharedExpenseRow {
    id: string;
    transaction_id: string;
    total_amount: number;
    personal_share: number;
    description: string | null;
    created_at: string;
}

interface SharedExpenseParticipantRow {
    id: string;
    shared_expense_id: string;
    name: string;
    expected_amount: number;
    paid_amount: number;
    created_at: string;
}

interface ReimbursementAllocationRow {
    id: string;
    reimbursement_transaction_id: string;
    shared_expense_id: string;
    participant_id: string | null;
    allocated_amount: number;
    created_at: string;
}

interface LoanRow {
    id: string;
    type: 'LENT' | 'BORROWED';
    counterparty: string;
    principal_amount: number;
    disbursement_transaction_id: string | null;
    wallet_id: string | null;
    interest_rate: number | null;
    due_date: string | null;
    status: 'ACTIVE' | 'SETTLED' | 'DEFAULTED';
    notes: string | null;
    created_at: string;
}

interface LoanRepaymentRow {
    id: string;
    loan_id: string;
    transaction_id: string | null;
    principal_repaid: number;
    interest_paid: number;
    fee_paid: number;
    repayment_date: string;
    notes: string | null;
    created_at: string;
}

interface MerchantRow {
    id: string;
    name: string;
    normalized_name: string;
    merchant_type: string | null;
    default_category_id: string | null;
    created_at: string;
}

interface MerchantRuleRow {
    id: string;
    pattern: string;
    merchant_id: string;
    category_id: string;
    auto_apply: number;
    created_at: string;
}

interface EducationInstitutionRow {
    id: string;
    name: string;
    normalized_name: string;
    default_category_id: string | null;
    preferred_frequency: string;
    preferred_fee_type: string;
    created_at: string;
}

interface EducationCommitmentRow {
    id: string;
    institution_id: string;
    student_name: string | null;
    fee_type: string;
    frequency: string;
    expected_amount: number | null;
    academic_term: string | null;
    academic_year: string | null;
    created_at: string;
}

interface BillConfirmationRow {
    id: string;
    biller_name: string;
    account_number: string | null;
    bill_reference: string | null;
    amount: number;
    confirmation_code: string | null;
    raw_message: string | null;
    message_date: string;
    status: 'UNMATCHED' | 'MATCHED' | 'AMBIGUOUS';
    matched_transaction_id: string | null;
    created_at: string;
}

interface TelecomPackageRow {
    id: string;
    package_name: string;
    category: 'data' | 'voice' | 'sms' | 'combo' | 'unlimited';
    volume_mb: number | null;
    sms_count: number | null;
    voice_minutes: number | null;
    validity_period: string | null;
    is_active: number;
    created_at: string;
}

interface TelecomEventRow {
    id: string;
    package_instance_id: string | null;
    package_name: string;
    event_type: TelecomEventType;
    event_time: string;
    price: number | null;
    transaction_id: string | null;
    volume_text: string | null;
    usage_percentage: number | null;
    expiry_time: string | null;
    raw_sms: string | null;
    created_at: string;
}

interface RecurringCommitmentRow {
    id: string;
    name: string;
    commitment_type: string;
    category_id: string;
    expected_amount: number | null;
    is_variable_amount: number;
    frequency: string;
    billing_day: number | null;
    next_expected_date: string | null;
    status: CommitmentStatus;
    merchant_id: string | null;
    institution_id: string | null;
    wallet_id: string | null;
    created_at: string;
}

interface KnownAccountRow {
    id: string;
    wallet_id: string | null;
    provider_id: string;
    account_type: string;
    account_number: string;
    account_last4: string | null;
    display_name: string;
    masked_identifier: string;
    ownership: 'OWN' | 'EXTERNAL';
    created_at: string;
}

async function getDefaultTransferCategories(db: SQLite.SQLiteDatabase): Promise<{ expenseCategoryId: string; incomeCategoryId: string }> {
    const expenseCat = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM categories WHERE flow = 'EXPENSE' ORDER BY is_built_in DESC, id ASC LIMIT 1;"
    );
    const incomeCat = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM categories WHERE flow = 'INCOME' ORDER BY is_built_in DESC, id ASC LIMIT 1;"
    );
    if (!expenseCat || !incomeCat) {
        throw new Error('Default transfer categories not available.');
    }
    return { expenseCategoryId: expenseCat.id, incomeCategoryId: incomeCat.id };
}

// 1. Transfers
export async function createTransferDB(params: {
    fromWalletId: string;
    toWalletId: string;
    amount: number;
    feeAmount?: number;
    note?: string;
    date?: string;
    datePrecision?: Transaction['datePrecision']; eventDate?: string;
    fromSmsReference?: string;
    toSmsReference?: string;
    fromRawSms?: string;
    toRawSms?: string;
    reconciledFromBalance?: number;
    reconciledToBalance?: number;
    source?: 'manual' | 'sms';
    smsImport?: { id: string; fromFingerprint: string; toFingerprint: string; messageKeys: string[]; vatAmount?: number;
        fromCbeDetails?:Transaction['smsDetails'];toCbeDetails?:Transaction['smsDetails'];fromCompatibleFingerprints?:string[];toCompatibleFingerprints?:string[];
        fromReceivedAt?: number; toReceivedAt?: number; fromEventDate?: string; toEventDate?: string;
        fromDateSource?: Transaction['dateSource']; toDateSource?: Transaction['dateSource']; fromDatePrecision?: Transaction['datePrecision']; toDatePrecision?: Transaction['datePrecision'] };
}): Promise<Transfer> {
    if (params.fromWalletId === params.toWalletId) {
        throw new Error('Transfer requires two distinct wallets.');
    }
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
        throw new Error('Transfer amount must be greater than zero.');
    }
    for (const amount of [params.amount,params.feeAmount ?? 0]) if (!Number.isSafeInteger(Math.round(amount*100)) || amount < 0 || Math.abs(amount*100-Math.round(amount*100))>0.00001) throw Error('Transfer amounts must be exact integer santim.');
    if (params.source === 'sms' && (!params.date || !isValidDate(params.date))) throw Error('An SMS transfer needs its original event date.');

    return withExclusiveTransaction(async (db) => {
        if (params.smsImport) {
            const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM transfers WHERE id = ?;', [params.smsImport.id]);
            if (existing) {
                const row = await db.getFirstAsync<any>('SELECT * FROM transfers WHERE id = ?;', [existing.id]);
                return { id: row.id, fromTransactionId: row.from_transaction_id, toTransactionId: row.to_transaction_id,
                    fromWalletId: row.from_wallet_id, toWalletId: row.to_wallet_id, amount: row.amount,
                    feeAmount: row.fee_amount, feeTransactionId: row.fee_transaction_id ?? undefined, createdAt: row.created_at };
            }
            const fingerprints=[...(params.smsImport.fromCompatibleFingerprints ?? [params.smsImport.fromFingerprint]),...(params.smsImport.toCompatibleFingerprints ?? [params.smsImport.toFingerprint])];
            const duplicate = await db.getFirstAsync(`SELECT id FROM transactions WHERE sms_fingerprint IN (${fingerprints.map(()=>'?').join(',')});`,fingerprints);
            if (duplicate) throw new Error('A transfer leg is already imported. Review the existing ledger entry.');
        }
        const fromWallet = await db.getFirstAsync<{ id: string; name: string; currency: string;provider_id:string }>(
            'SELECT id, name, currency,provider_id FROM wallets WHERE id = ?;',
            [params.fromWalletId]
        );
        const toWallet = await db.getFirstAsync<{ id: string; name: string; currency: string;provider_id:string }>(
            'SELECT id, name, currency,provider_id FROM wallets WHERE id = ?;',
            [params.toWalletId]
        );
        if (!fromWallet || !toWallet) {
            throw new Error('One or both wallets for the transfer could not be found.');
        }
        if (fromWallet.currency !== toWallet.currency) throw Error('Transfers need accounts in the same currency; currency conversion is not configured.');
        if((params.source==='sms' || params.fromSmsReference) && fromWallet.provider_id==='cbe' && !params.smsImport?.fromCbeDetails)throw Error('CBE transfer requires shared source validation.');
        if((params.source==='sms' || params.toSmsReference) && toWallet.provider_id==='cbe' && !params.smsImport?.toCbeDetails)throw Error('CBE transfer requires shared destination validation.');

        const { expenseCategoryId, incomeCategoryId } = await getDefaultTransferCategories(db);
        const now = new Date().toISOString();
        const date = params.date || now;
        const transferId = params.smsImport?.id || `tr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const fromTxId = `tx-out-${transferId}`;
        const toTxId = `tx-in-${transferId}`;

        const outSource = params.source || (params.fromSmsReference ? 'sms' : 'manual');
        const inSource = params.source || (params.toSmsReference ? 'sms' : 'manual');

        // Insert Outgoing Leg (DEBIT)
        await db.runAsync(
            `INSERT INTO transactions
            (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source, raw_sms, sms_reference, sms_fingerprint, is_transfer, transfer_wallet_id, sub_type, counterparty, fee_amount, vat_amount, created_at)
            VALUES (?, ?, 'DEBIT', ?, ?, ?, 'CLEARED', ?, ?, ?, ?, ?, ?, 1, ?, 'TRANSFER', ?, ?, ?, ?);`,
            [
                fromTxId,
                params.amount,
                expenseCategoryId,
                params.note ? `${params.note} (To ${toWallet.name})` : `Transfer to ${toWallet.name}`,
                date,
                params.fromWalletId,
                params.reconciledFromBalance ?? null,
                outSource,
                params.fromRawSms ?? null,
                params.fromSmsReference ?? null,
                params.smsImport?.fromFingerprint ?? null,
                params.toWalletId,
                toWallet.name,
                params.feeAmount ?? null,
                params.smsImport?.vatAmount ?? null,
                now,
            ]
        );

        // Insert Incoming Leg (CREDIT)
        await db.runAsync(
            `INSERT INTO transactions
            (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source, raw_sms, sms_reference, sms_fingerprint, is_transfer, transfer_wallet_id, sub_type, counterparty, created_at)
            VALUES (?, ?, 'CREDIT', ?, ?, ?, 'CLEARED', ?, ?, ?, ?, ?, ?, 1, ?, 'TRANSFER', ?, ?);`,
            [
                toTxId,
                params.amount,
                incomeCategoryId,
                params.note ? `${params.note} (From ${fromWallet.name})` : `Transfer from ${fromWallet.name}`,
                date,
                params.toWalletId,
                params.reconciledToBalance ?? null,
                inSource,
                params.toRawSms ?? null,
                params.toSmsReference ?? null,
                params.smsImport?.toFingerprint ?? null,
                params.fromWalletId,
                fromWallet.name,
                now,
            ]
        );

        // Deduct from sender wallet (reconcile if provided, else subtract total debit)
        if (params.reconciledFromBalance != null && Number.isFinite(params.reconciledFromBalance)) {
            await db.runAsync('UPDATE wallets SET balance = ? WHERE id = ?;', [
                params.reconciledFromBalance,
                params.fromWalletId,
            ]);
        } else {
            const totalDebit = (Math.round(params.amount * 100) + Math.round((params.feeAmount ?? 0) * 100)) / 100;
            await db.runAsync(
                params.smsImport ? 'UPDATE wallets SET balance = (ROUND(balance * 100) - ?) / 100.0 WHERE id = ?;' : 'UPDATE wallets SET balance = balance - ? WHERE id = ?;',
                [params.smsImport ? Math.round(totalDebit * 100) : totalDebit, params.fromWalletId]
            );
        }

        // Add to recipient wallet (reconcile if provided, else add amount)
        if (params.reconciledToBalance != null && Number.isFinite(params.reconciledToBalance)) {
            await db.runAsync('UPDATE wallets SET balance = ? WHERE id = ?;', [
                params.reconciledToBalance,
                params.toWalletId,
            ]);
        } else {
            await db.runAsync(
                params.smsImport ? 'UPDATE wallets SET balance = (ROUND(balance * 100) + ?) / 100.0 WHERE id = ?;' : 'UPDATE wallets SET balance = balance + ? WHERE id = ?;',
                [params.smsImport ? Math.round(params.amount * 100) : params.amount, params.toWalletId]
            );
        }

        let feeTxId: string | undefined = undefined;
        if (params.feeAmount && params.feeAmount > 0) {
            feeTxId = `tx-fee-${transferId}`;
            await db.runAsync(
                `INSERT INTO transactions
                (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source, raw_sms, sms_reference, sms_fingerprint, is_transfer, sub_type, created_at)
                VALUES (?, ?, 'DEBIT', ?, ?, ?, 'CLEARED', ?, NULL, ?, NULL, NULL, NULL, 0, 'FEE', ?);`,
                [
                    feeTxId,
                    params.feeAmount,
                    expenseCategoryId,
                    `Transfer fee: ${params.note || `to ${toWallet.name}`}`.trim(),
                    date,
                    params.fromWalletId,
                    outSource,
                    now,
                ]
            );
        }

        await db.runAsync(
            `INSERT INTO transfers
            (id, from_transaction_id, to_transaction_id, from_wallet_id, to_wallet_id, amount, fee_amount, fee_transaction_id, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                transferId,
                fromTxId,
                toTxId,
                params.fromWalletId,
                params.toWalletId,
                params.amount,
                params.feeAmount ?? 0,
                feeTxId ?? null,
                params.note ?? null,
                now,
            ]
        );

        if(params.datePrecision) {
            for(const id of [fromTxId,toTxId,...(feeTxId ? [feeTxId] : [])]) {
                await db.runAsync('UPDATE transactions SET date_precision=?,event_date=? WHERE id=?',[params.datePrecision,params.eventDate ?? null,id]);
                assertValidTransaction(mapTransaction((await db.getFirstAsync<TransactionRow>('SELECT * FROM transactions WHERE id=?',[id]))!));
            }
        }
        if (params.smsImport) {
            const provenance = params.smsImport;
            for(const [ids,details] of [[[fromTxId,...(feeTxId ? [feeTxId]:[])],provenance.fromCbeDetails],[[toTxId],provenance.toCbeDetails]] as const) {
                if(details)for(const id of ids) {
                    await db.runAsync('UPDATE transactions SET sms_details=? WHERE id=?',[JSON.stringify(details),id]);
                    const transaction=mapTransaction((await db.getFirstAsync<TransactionRow>('SELECT * FROM transactions WHERE id=?',[id]))!);
                    assertValidTransaction(transaction);await assertTransactionReferences(db,transaction);
                }
            }
            for (const [ids,received,eventDate,dateSource,datePrecision] of [
                [[fromTxId,...(feeTxId ? [feeTxId] : [])],provenance.fromReceivedAt,provenance.fromEventDate,provenance.fromDateSource,provenance.fromDatePrecision],
                [[toTxId],provenance.toReceivedAt,provenance.toEventDate,provenance.toDateSource,provenance.toDatePrecision],
            ] as const) {
                if (eventDate && !isValidDate(eventDate)) throw Error('Transfer event date is invalid.');
                for (const id of ids) {
                    await db.runAsync('UPDATE transactions SET date=?,occurred_at=?,received_at=?,imported_at=?,date_source=?,date_precision=? WHERE id=?',
                        [eventDate ?? date,Date.parse(eventDate ?? date),received ?? null,Date.parse(now),dateSource ?? 'legacy',datePrecision ?? params.datePrecision ?? null,id]);
                    assertValidTransaction(mapTransaction((await db.getFirstAsync<TransactionRow>('SELECT * FROM transactions WHERE id=?',[id]))!));
                }
            }
            for (const key of params.smsImport.messageKeys) {
                await db.runAsync('INSERT INTO sms_import_receipts(message_key, transaction_id, created_at) VALUES (?, ?, ?);',
                    [key, key === params.smsImport.messageKeys[0] ? fromTxId : toTxId, now]);
            }
        }
        return {
            id: transferId,
            fromTransactionId: fromTxId,
            toTransactionId: toTxId,
            fromWalletId: params.fromWalletId,
            toWalletId: params.toWalletId,
            amount: params.amount,
            feeAmount: params.feeAmount ?? 0,
            feeTransactionId: feeTxId,
            note: params.note,
            createdAt: now,
        };
    });
}

export async function completeTransferLegDB(params: {
    existingTransactionId: string;
    newLeg: {
        walletId: string;
        type: 'DEBIT' | 'CREDIT';
        amount: number;
        feeAmount?: number;
        smsReference?: string;
        rawSms?: string;
        currentBalance?: number;
        date?: string;
        datePrecision?: Transaction['datePrecision']; eventDate?: string; receivedAt?: number; dateSource?: Transaction['dateSource'];
        note?: string;
    };
    note?: string;
}): Promise<Transfer> {
    return withExclusiveTransaction(async (db) => {
        const existingTx = await db.getFirstAsync<TransactionRow>(
            'SELECT * FROM transactions WHERE id = ?;',
            [params.existingTransactionId]
        );
        if (!existingTx) {
            throw new Error(`Transaction with id ${params.existingTransactionId} not found.`);
        }
        const accounts=await db.getAllAsync<{provider_id:string}>('SELECT provider_id FROM wallets WHERE id IN (?,?)',[existingTx.wallet_id,params.newLeg.walletId]);
        if(accounts.some(w=>w.provider_id==='cbe'))throw Error('CBE transfer completion requires the shared reviewed import plan; direct leg completion is not permitted.');

        const now = new Date().toISOString();
        const date = params.newLeg.date || now;
        const transferId = `tr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const { expenseCategoryId, incomeCategoryId } = await getDefaultTransferCategories(db);

        let fromTxId: string;
        let toTxId: string;
        let fromWalletId: string;
        let toWalletId: string;
        let feeTxId: string | null = null;
        const principalAmount = params.newLeg.amount;
        let totalFee = 0;

        if (existingTx.type === 'DEBIT') {
            // Existing is DEBIT (Source leg), new leg is CREDIT (Destination leg)
            fromTxId = existingTx.id;
            fromWalletId = existingTx.wallet_id;
            toWalletId = params.newLeg.walletId;
            toTxId = `tx-in-${transferId}`;
            totalFee = existingTx.fee_amount ?? params.newLeg.feeAmount ?? 0;

            const fromWallet = await db.getFirstAsync<{ id: string; name: string }>(
                'SELECT id, name FROM wallets WHERE id = ?;',
                [fromWalletId]
            );
            const toWallet = await db.getFirstAsync<{ id: string; name: string }>(
                'SELECT id, name FROM wallets WHERE id = ?;',
                [toWalletId]
            );

            // Update existing debit transaction to link to destination wallet
            await db.runAsync(
                `UPDATE transactions
                SET is_transfer = 1,
                    sub_type = 'TRANSFER',
                    transfer_wallet_id = ?,
                    counterparty = COALESCE(counterparty, ?)
                WHERE id = ?;`,
                [toWalletId, toWallet?.name ?? 'Destination Account', fromTxId]
            );

            // Insert new credit leg
            await db.runAsync(
                `INSERT INTO transactions
                (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source, raw_sms, sms_reference, is_transfer, transfer_wallet_id, sub_type, counterparty, created_at)
                VALUES (?, ?, 'CREDIT', ?, ?, ?, 'CLEARED', ?, ?, 'sms', ?, ?, 1, ?, 'TRANSFER', ?, ?);`,
                [
                    toTxId,
                    principalAmount,
                    incomeCategoryId,
                    params.newLeg.note || `Transfer from ${fromWallet?.name ?? 'source account'}`,
                    date,
                    toWalletId,
                    params.newLeg.currentBalance ?? null,
                    params.newLeg.rawSms ?? null,
                    params.newLeg.smsReference ?? null,
                    fromWalletId,
                    fromWallet?.name ?? 'Source Account',
                    now,
                ]
            );

            // Update destination wallet balance
            if (params.newLeg.currentBalance != null && Number.isFinite(params.newLeg.currentBalance)) {
                await db.runAsync('UPDATE wallets SET balance = ? WHERE id = ?;', [
                    params.newLeg.currentBalance,
                    toWalletId,
                ]);
            } else {
                await db.runAsync('UPDATE wallets SET balance = balance + ? WHERE id = ?;', [
                    principalAmount,
                    toWalletId,
                ]);
            }

            // Check if existingTx already had a fee transaction
            const existingFeeTx = await db.getFirstAsync<{ id: string }>(
                "SELECT id FROM transactions WHERE wallet_id = ? AND sub_type = 'FEE' AND date = ?;",
                [fromWalletId, existingTx.date]
            );
            if (existingFeeTx) {
                feeTxId = existingFeeTx.id;
            }
        } else {
            // Existing is CREDIT (Destination leg), new leg is DEBIT (Source leg)
            toTxId = existingTx.id;
            toWalletId = existingTx.wallet_id;
            fromWalletId = params.newLeg.walletId;
            fromTxId = `tx-out-${transferId}`;
            totalFee = params.newLeg.feeAmount ?? 0;

            const fromWallet = await db.getFirstAsync<{ id: string; name: string }>(
                'SELECT id, name FROM wallets WHERE id = ?;',
                [fromWalletId]
            );
            const toWallet = await db.getFirstAsync<{ id: string; name: string }>(
                'SELECT id, name FROM wallets WHERE id = ?;',
                [toWalletId]
            );

            // Update existing credit transaction to link to source wallet
            await db.runAsync(
                `UPDATE transactions
                SET is_transfer = 1,
                    sub_type = 'TRANSFER',
                    transfer_wallet_id = ?,
                    counterparty = COALESCE(counterparty, ?)
                WHERE id = ?;`,
                [fromWalletId, fromWallet?.name ?? 'Source Account', toTxId]
            );

            // Insert new debit leg
            await db.runAsync(
                `INSERT INTO transactions
                (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source, raw_sms, sms_reference, is_transfer, transfer_wallet_id, sub_type, counterparty, fee_amount, created_at)
                VALUES (?, ?, 'DEBIT', ?, ?, ?, 'CLEARED', ?, ?, 'sms', ?, ?, 1, ?, 'TRANSFER', ?, ?, ?);`,
                [
                    fromTxId,
                    principalAmount,
                    expenseCategoryId,
                    params.newLeg.note || `Transfer to ${toWallet?.name ?? 'destination account'}`,
                    date,
                    fromWalletId,
                    params.newLeg.currentBalance ?? null,
                    params.newLeg.rawSms ?? null,
                    params.newLeg.smsReference ?? null,
                    toWalletId,
                    toWallet?.name ?? 'Destination Account',
                    totalFee > 0 ? totalFee : null,
                    now,
                ]
            );

            // If fee > 0, insert fee transaction
            if (totalFee > 0) {
                feeTxId = `tx-fee-${transferId}`;
                await db.runAsync(
                    `INSERT INTO transactions
                    (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source, raw_sms, sms_reference, is_transfer, sub_type, created_at)
                    VALUES (?, ?, 'DEBIT', ?, ?, ?, 'CLEARED', ?, NULL, 'sms', NULL, NULL, 0, 'FEE', ?);`,
                    [
                        feeTxId,
                        totalFee,
                        expenseCategoryId,
                        `Transfer fee: ${toWallet?.name ?? 'to account'}`,
                        date,
                        fromWalletId,
                        now,
                    ]
                );
            }

            // Update source wallet balance
            if (params.newLeg.currentBalance != null && Number.isFinite(params.newLeg.currentBalance)) {
                await db.runAsync('UPDATE wallets SET balance = ? WHERE id = ?;', [
                    params.newLeg.currentBalance,
                    fromWalletId,
                ]);
            } else {
                const totalDebit = principalAmount + totalFee;
                await db.runAsync('UPDATE wallets SET balance = balance - ? WHERE id = ?;', [
                    totalDebit,
                    fromWalletId,
                ]);
            }
        }

        const newIds=[params.newLeg.type==='DEBIT' ? fromTxId : toTxId,...(params.newLeg.type==='DEBIT' && feeTxId ? [feeTxId] : [])];
        for(const id of newIds) {
            await db.runAsync('UPDATE transactions SET date_precision=?,event_date=?,received_at=?,date_source=? WHERE id=?',
                [params.newLeg.datePrecision ?? null,params.newLeg.eventDate ?? null,params.newLeg.receivedAt ?? null,params.newLeg.dateSource ?? 'manual',id]);
            assertValidTransaction(mapTransaction((await db.getFirstAsync<TransactionRow>('SELECT * FROM transactions WHERE id=?',[id]))!));
        }
        // Link in transfers table
        await db.runAsync(
            `INSERT INTO transfers
            (id, from_transaction_id, to_transaction_id, from_wallet_id, to_wallet_id, amount, fee_amount, fee_transaction_id, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                transferId,
                fromTxId,
                toTxId,
                fromWalletId,
                toWalletId,
                principalAmount,
                totalFee,
                feeTxId,
                params.note || 'Linked own-account transfer',
                now,
            ]
        );

        return {
            id: transferId,
            fromTransactionId: fromTxId,
            toTransactionId: toTxId,
            fromWalletId,
            toWalletId,
            amount: principalAmount,
            feeAmount: totalFee,
            feeTransactionId: feeTxId || undefined,
            note: params.note || 'Linked own-account transfer',
            createdAt: now,
        };
    });
}

export async function getTransfersDB(): Promise<Transfer[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TransferRow>('SELECT * FROM transfers ORDER BY created_at DESC;');
    return rows.map((r) => ({
        id: r.id,
        fromTransactionId: r.from_transaction_id || undefined,
        toTransactionId: r.to_transaction_id || undefined,
        fromWalletId: r.from_wallet_id,
        toWalletId: r.to_wallet_id,
        amount: Number(r.amount),
        feeAmount: r.fee_amount != null ? Number(r.fee_amount) : undefined,
        feeTransactionId: r.fee_transaction_id || undefined,
        note: r.note || undefined,
        createdAt: r.created_at,
    }));
}

// 2. Refunds
export async function allocateRefundDB(params: {
    refundTransactionId: string;
    originalTransactionId?: string;
    allocatedAmount: number;
    notes?: string;
}): Promise<RefundAllocation> {
    if (!Number.isFinite(params.allocatedAmount) || params.allocatedAmount <= 0) {
        throw new Error('Refund allocation amount must be greater than zero.');
    }
    if (!Number.isSafeInteger(Math.round(params.allocatedAmount*100)) || Math.abs(params.allocatedAmount*100-Math.round(params.allocatedAmount*100))>0.00001) throw Error('Refund allocation must be integer santim.');

    return withExclusiveTransaction(async (db) => {
        const refundTx = await db.getFirstAsync<{ id: string; amount: number; type: string }>(
            'SELECT id, amount, type FROM transactions WHERE id = ?;',
            [params.refundTransactionId]
        );
        if (!refundTx) throw new Error('Refund credit transaction not found.');
        if (refundTx.type !== 'CREDIT') throw new Error('Refund transaction must be a CREDIT.');
        const allocated = await db.getFirstAsync<{minor:number}>('SELECT COALESCE(SUM(CAST(ROUND(allocated_amount*100) AS INTEGER)),0) AS minor FROM refund_allocations WHERE refund_transaction_id=?',[params.refundTransactionId]);
        if ((allocated?.minor ?? 0)+Math.round(params.allocatedAmount*100)>Math.round(refundTx.amount*100)) throw Error('Allocations exceed the refund credit.');

        if (params.originalTransactionId) {
            const origTx = await db.getFirstAsync<{ id: string; amount: number; type: string }>(
                'SELECT id, amount, type FROM transactions WHERE id = ?;',
                [params.originalTransactionId]
            );
            if (!origTx) throw new Error('Original purchase transaction not found.');
            if (origTx.type !== 'DEBIT') throw new Error('Original transaction must be a DEBIT.');
            const used = await db.getFirstAsync<{minor:number}>('SELECT COALESCE(SUM(CAST(ROUND(allocated_amount*100) AS INTEGER)),0) AS minor FROM refund_allocations WHERE original_transaction_id=?',[params.originalTransactionId]);
            if ((used?.minor ?? 0)+Math.round(params.allocatedAmount*100)>Math.round(origTx.amount*100)) throw Error('Allocations exceed the original purchase.');
        }

        const now = new Date().toISOString();
        const allocId = `ref-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        await db.runAsync(
            "UPDATE transactions SET sub_type = 'REFUND' WHERE id = ?;",
            [params.refundTransactionId]
        );

        await db.runAsync(
            `INSERT INTO refund_allocations
            (id, refund_transaction_id, original_transaction_id, allocated_amount, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?);`,
            [
                allocId,
                params.refundTransactionId,
                params.originalTransactionId ?? null,
                params.allocatedAmount,
                params.notes ?? null,
                now,
            ]
        );

        return {
            id: allocId,
            refundTransactionId: params.refundTransactionId,
            originalTransactionId: params.originalTransactionId,
            allocatedAmount: params.allocatedAmount,
            notes: params.notes,
            createdAt: now,
        };
    });
}

/** Reviewed refund/reversal credit, optional purchase link and receipt form one ledger commit. */
export async function importReviewedRefundDB(transaction: Transaction, messageKey?: string, originalId?: string): Promise<void> {
    const refund: Transaction = { ...transaction, subType: 'REFUND' };
    assertValidTransaction(refund);
    if (refund.type !== 'CREDIT' || refund.status !== 'CLEARED') throw Error('A reviewed refund must be a confirmed credit.');
    await withExclusiveTransaction(async db => {
        await assertTransactionReferences(db, refund);
        if (messageKey && await db.getFirstAsync('SELECT 1 FROM sms_import_receipts WHERE message_key=?',[messageKey])) throw Error('This message has already been imported.');
        if (originalId) {
            const original = await db.getFirstAsync<{ amount: number; type: string; status: string; currency: string }>(`SELECT t.amount,t.type,t.status,w.currency FROM transactions t JOIN wallets w ON w.id=t.wallet_id WHERE t.id=? AND t.is_transfer=0`,[originalId]);
            const account = await db.getFirstAsync<{currency:string}>('SELECT currency FROM wallets WHERE id=?',[refund.walletId]);
            if (!original || original.type !== 'DEBIT' || original.status !== 'CLEARED' || original.currency !== account?.currency) throw Error('Select a confirmed purchase in the same currency.');
            const prior = await db.getFirstAsync<{minor:number}>('SELECT COALESCE(SUM(CAST(ROUND(allocated_amount*100) AS INTEGER)),0) AS minor FROM refund_allocations WHERE original_transaction_id=?',[originalId]);
            if ((prior?.minor ?? 0) + Math.round(refund.amount*100) > Math.round(original.amount*100)) throw Error('This refund exceeds the unrefunded purchase amount. Review the amount or choose another purchase.');
        }
        const insert = transactionInsert(refund); await db.runAsync(insert.sql,insert.params);
        await db.runAsync('INSERT INTO refund_allocations(id,refund_transaction_id,original_transaction_id,allocated_amount,notes,created_at) VALUES(?,?,?,?,?,?)',
            [`refund-${refund.id}`,refund.id,originalId ?? null,refund.amount,'User-confirmed refund or reversal',refund.createdAt]);
        if (messageKey) await db.runAsync('INSERT INTO sms_import_receipts(message_key,transaction_id,created_at) VALUES(?,?,?)',[messageKey,refund.id,refund.createdAt]);
    });
}

export async function getRefundAllocationsDB(): Promise<RefundAllocation[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<RefundAllocationRow>('SELECT * FROM refund_allocations ORDER BY created_at DESC;');
    return rows.map((r) => ({
        id: r.id,
        refundTransactionId: r.refund_transaction_id,
        originalTransactionId: r.original_transaction_id || undefined,
        allocatedAmount: Number(r.allocated_amount),
        notes: r.notes || undefined,
        createdAt: r.created_at,
    }));
}

// 3. Shared Expenses & Reimbursements
export async function createSharedExpenseDB(params: {
    transactionId: string;
    totalAmount: number;
    personalShare: number;
    description?: string;
    participants: Array<{ name: string; expectedAmount: number }>;
}): Promise<SharedExpenseWithDetails> {
    if (!Number.isFinite(params.totalAmount) || params.totalAmount <= 0) {
        throw new Error('Total amount must be greater than zero.');
    }
    if (!Number.isFinite(params.personalShare) || params.personalShare < 0) {
        throw new Error('Personal share must be non-negative.');
    }

    return withExclusiveTransaction(async (db) => {
        const tx = await db.getFirstAsync<{ id: string; type: string }>(
            'SELECT id, type FROM transactions WHERE id = ?;',
            [params.transactionId]
        );
        if (!tx) throw new Error('Parent transaction for shared expense not found.');
        if (tx.type !== 'DEBIT') throw new Error('Shared expense must be attached to a DEBIT transaction.');

        const now = new Date().toISOString();
        const sharedExpenseId = `se-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        await db.runAsync(
            "UPDATE transactions SET sub_type = 'SHARED_EXPENSE' WHERE id = ?;",
            [params.transactionId]
        );

        await db.runAsync(
            `INSERT INTO shared_expenses
            (id, transaction_id, total_amount, personal_share, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?);`,
            [
                sharedExpenseId,
                params.transactionId,
                params.totalAmount,
                params.personalShare,
                params.description ?? null,
                now,
            ]
        );

        const createdParticipants: SharedExpenseParticipant[] = [];
        for (const p of params.participants) {
            const pId = `sep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            await db.runAsync(
                `INSERT INTO shared_expense_participants
                (id, shared_expense_id, name, expected_amount, paid_amount, created_at)
                VALUES (?, ?, ?, ?, 0, ?);`,
                [pId, sharedExpenseId, p.name.trim(), p.expectedAmount, now]
            );
            createdParticipants.push({
                id: pId,
                sharedExpenseId,
                name: p.name.trim(),
                expectedAmount: p.expectedAmount,
                paidAmount: 0,
                createdAt: now,
            });
        }

        const expectedOthers = Math.max(0, params.totalAmount - params.personalShare);

        return {
            id: sharedExpenseId,
            transactionId: params.transactionId,
            totalAmount: params.totalAmount,
            personalShare: params.personalShare,
            description: params.description,
            createdAt: now,
            participants: createdParticipants,
            reimbursements: [],
            totalReimbursed: 0,
            outstandingReceivable: expectedOthers,
            realizedPersonalCost: params.totalAmount,
        };
    });
}

export async function allocateReimbursementDB(params: {
    reimbursementTransactionId: string;
    sharedExpenseId: string;
    participantId?: string;
    allocatedAmount: number;
}): Promise<ReimbursementAllocation> {
    if (!Number.isFinite(params.allocatedAmount) || params.allocatedAmount <= 0) {
        throw new Error('Reimbursement allocation must be greater than zero.');
    }

    return withExclusiveTransaction(async (db) => {
        const reimbTx = await db.getFirstAsync<{ id: string; type: string }>(
            'SELECT id, type FROM transactions WHERE id = ?;',
            [params.reimbursementTransactionId]
        );
        if (!reimbTx) throw new Error('Reimbursement credit transaction not found.');
        if (reimbTx.type !== 'CREDIT') throw new Error('Reimbursement transaction must be a CREDIT.');

        const se = await db.getFirstAsync<{ id: string }>(
            'SELECT id FROM shared_expenses WHERE id = ?;',
            [params.sharedExpenseId]
        );
        if (!se) throw new Error('Shared expense record not found.');

        const now = new Date().toISOString();
        const allocId = `reimb-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        await db.runAsync(
            "UPDATE transactions SET sub_type = 'REIMBURSEMENT' WHERE id = ?;",
            [params.reimbursementTransactionId]
        );

        if (params.participantId) {
            await db.runAsync(
                'UPDATE shared_expense_participants SET paid_amount = paid_amount + ? WHERE id = ?;',
                [params.allocatedAmount, params.participantId]
            );
        }

        await db.runAsync(
            `INSERT INTO reimbursement_allocations
            (id, reimbursement_transaction_id, shared_expense_id, participant_id, allocated_amount, created_at)
            VALUES (?, ?, ?, ?, ?, ?);`,
            [
                allocId,
                params.reimbursementTransactionId,
                params.sharedExpenseId,
                params.participantId ?? null,
                params.allocatedAmount,
                now,
            ]
        );

        return {
            id: allocId,
            reimbursementTransactionId: params.reimbursementTransactionId,
            sharedExpenseId: params.sharedExpenseId,
            participantId: params.participantId,
            allocatedAmount: params.allocatedAmount,
            createdAt: now,
        };
    });
}

export async function getSharedExpensesDB(): Promise<SharedExpenseWithDetails[]> {
    const db = await getDatabase();
    const expenses = await db.getAllAsync<SharedExpenseRow>(
        'SELECT * FROM shared_expenses ORDER BY created_at DESC;'
    );
    if (expenses.length === 0) return [];

    const participants = await db.getAllAsync<SharedExpenseParticipantRow>(
        'SELECT * FROM shared_expense_participants ORDER BY created_at ASC;'
    );
    const reimbursements = await db.getAllAsync<ReimbursementAllocationRow>(
        'SELECT * FROM reimbursement_allocations ORDER BY created_at ASC;'
    );

    return expenses.map((se) => {
        const seParticipants = participants
            .filter((p) => p.shared_expense_id === se.id)
            .map((p) => ({
                id: p.id,
                sharedExpenseId: p.shared_expense_id,
                name: p.name,
                expectedAmount: Number(p.expected_amount),
                paidAmount: Number(p.paid_amount),
                createdAt: p.created_at,
            }));

        const seReimbursements = reimbursements
            .filter((r) => r.shared_expense_id === se.id)
            .map((r) => ({
                id: r.id,
                reimbursementTransactionId: r.reimbursement_transaction_id,
                sharedExpenseId: r.shared_expense_id,
                participantId: r.participant_id || undefined,
                allocatedAmount: Number(r.allocated_amount),
                createdAt: r.created_at,
            }));

        const totalReimbursed = seReimbursements.reduce((sum, r) => sum + r.allocatedAmount, 0);
        const othersExpected = Math.max(0, Number(se.total_amount) - Number(se.personal_share));
        const outstandingReceivable = Math.max(0, othersExpected - totalReimbursed);
        const realizedPersonalCost = Math.max(0, Number(se.total_amount) - totalReimbursed);

        return {
            id: se.id,
            transactionId: se.transaction_id,
            totalAmount: Number(se.total_amount),
            personalShare: Number(se.personal_share),
            description: se.description || undefined,
            createdAt: se.created_at,
            participants: seParticipants,
            reimbursements: seReimbursements,
            totalReimbursed,
            outstandingReceivable,
            realizedPersonalCost,
        };
    });
}

// 4. Loans & Repayments
export async function createLoanDB(params: {
    type: LoanType;
    counterparty: string;
    principalAmount: number;
    walletId?: string;
    createTransaction?: boolean;
    interestRate?: number;
    dueDate?: string;
    notes?: string;
}): Promise<LoanWithDetails> {
    if (!params.counterparty.trim()) throw new Error('Counterparty name is required.');
    if (!Number.isFinite(params.principalAmount) || params.principalAmount <= 0) {
        throw new Error('Principal amount must be greater than zero.');
    }

    return withExclusiveTransaction(async (db) => {
        const now = new Date().toISOString();
        const loanId = `loan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        let txId: string | undefined = undefined;

        if (params.createTransaction && params.walletId) {
            const wallet = await db.getFirstAsync<{ id: string }>(
                'SELECT id FROM wallets WHERE id = ?;',
                [params.walletId]
            );
            if (!wallet) throw new Error('Wallet not found for loan disbursement.');

            const { expenseCategoryId, incomeCategoryId } = await getDefaultTransferCategories(db);
            txId = `tx-${loanId}`;

            if (params.type === 'LENT') {
                // User gave money to borrower -> DEBIT
                await db.runAsync(
                    `INSERT INTO transactions
                    (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source, is_transfer, sub_type, counterparty, created_at)
                    VALUES (?, ?, 'DEBIT', ?, ?, ?, 'CLEARED', ?, NULL, 'manual', 0, 'LOAN_DISBURSEMENT', ?, ?);`,
                    [
                        txId,
                        params.principalAmount,
                        expenseCategoryId,
                        `Loan to ${params.counterparty}`,
                        now,
                        params.walletId,
                        params.counterparty,
                        now,
                    ]
                );
                await db.runAsync(
                    'UPDATE wallets SET balance = balance - ? WHERE id = ?;',
                    [params.principalAmount, params.walletId]
                );
            } else {
                // User borrowed money from lender -> CREDIT
                await db.runAsync(
                    `INSERT INTO transactions
                    (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source, is_transfer, sub_type, counterparty, created_at)
                    VALUES (?, ?, 'CREDIT', ?, ?, ?, 'CLEARED', ?, NULL, 'manual', 0, 'LOAN_DISBURSEMENT', ?, ?);`,
                    [
                        txId,
                        params.principalAmount,
                        incomeCategoryId,
                        `Loan from ${params.counterparty}`,
                        now,
                        params.walletId,
                        params.counterparty,
                        now,
                    ]
                );
                await db.runAsync(
                    'UPDATE wallets SET balance = balance + ? WHERE id = ?;',
                    [params.principalAmount, params.walletId]
                );
            }
        }

        await db.runAsync(
            `INSERT INTO loans
            (id, type, counterparty, principal_amount, disbursement_transaction_id, wallet_id, interest_rate, due_date, status, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?);`,
            [
                loanId,
                params.type,
                params.counterparty.trim(),
                params.principalAmount,
                txId ?? null,
                params.walletId ?? null,
                params.interestRate ?? null,
                params.dueDate ?? null,
                params.notes ?? null,
                now,
            ]
        );

        return {
            id: loanId,
            type: params.type,
            counterparty: params.counterparty.trim(),
            principalAmount: params.principalAmount,
            disbursementTransactionId: txId,
            walletId: params.walletId,
            interestRate: params.interestRate,
            dueDate: params.dueDate,
            status: 'ACTIVE',
            notes: params.notes,
            createdAt: now,
            repayments: [],
            totalPrincipalRepaid: 0,
            totalInterestPaid: 0,
            totalFeePaid: 0,
            remainingPrincipal: params.principalAmount,
        };
    });
}

export async function recordLoanRepaymentDB(params: {
    loanId: string;
    principalRepaid: number;
    interestPaid?: number;
    feePaid?: number;
    walletId?: string;
    createTransaction?: boolean;
    repaymentDate: string;
    notes?: string;
}): Promise<LoanRepayment> {
    if (!Number.isFinite(params.principalRepaid) || params.principalRepaid < 0) {
        throw new Error('Principal repaid must be a valid non-negative number.');
    }

    return withExclusiveTransaction(async (db) => {
        const loan = await db.getFirstAsync<LoanRow>(
            'SELECT * FROM loans WHERE id = ?;',
            [params.loanId]
        );
        if (!loan) throw new Error('Loan record not found.');

        const now = new Date().toISOString();
        const repaymentId = `lr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        let txId: string | undefined = undefined;

        const totalCash = params.principalRepaid + (params.interestPaid || 0) + (params.feePaid || 0);

        if (params.createTransaction && params.walletId && totalCash > 0) {
            const { expenseCategoryId, incomeCategoryId } = await getDefaultTransferCategories(db);
            txId = `tx-${repaymentId}`;

            if (loan.type === 'LENT') {
                // Borrower paid user back -> CREDIT
                await db.runAsync(
                    `INSERT INTO transactions
                    (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source, is_transfer, sub_type, counterparty, created_at)
                    VALUES (?, ?, 'CREDIT', ?, ?, ?, 'CLEARED', ?, NULL, 'manual', 0, 'LOAN_REPAYMENT', ?, ?);`,
                    [
                        txId,
                        totalCash,
                        incomeCategoryId,
                        `Repayment from ${loan.counterparty}`,
                        params.repaymentDate,
                        params.walletId,
                        loan.counterparty,
                        now,
                    ]
                );
                await db.runAsync(
                    'UPDATE wallets SET balance = balance + ? WHERE id = ?;',
                    [totalCash, params.walletId]
                );
            } else {
                // User paid lender back -> DEBIT
                await db.runAsync(
                    `INSERT INTO transactions
                    (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source, is_transfer, sub_type, counterparty, created_at)
                    VALUES (?, ?, 'DEBIT', ?, ?, ?, 'CLEARED', ?, NULL, 'manual', 0, 'LOAN_REPAYMENT', ?, ?);`,
                    [
                        txId,
                        totalCash,
                        expenseCategoryId,
                        `Repayment to ${loan.counterparty}`,
                        params.repaymentDate,
                        params.walletId,
                        loan.counterparty,
                        now,
                    ]
                );
                await db.runAsync(
                    'UPDATE wallets SET balance = balance - ? WHERE id = ?;',
                    [totalCash, params.walletId]
                );
            }
        }

        await db.runAsync(
            `INSERT INTO loan_repayments
            (id, loan_id, transaction_id, principal_repaid, interest_paid, fee_paid, repayment_date, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                repaymentId,
                params.loanId,
                txId ?? null,
                params.principalRepaid,
                params.interestPaid ?? 0,
                params.feePaid ?? 0,
                params.repaymentDate,
                params.notes ?? null,
                now,
            ]
        );

        // Check if settled
        const priorRepaidRow = await db.getFirstAsync<{ total_repaid: number | null }>(
            'SELECT SUM(principal_repaid) AS total_repaid FROM loan_repayments WHERE loan_id = ?;',
            [params.loanId]
        );
        const totalRepaid = Number(priorRepaidRow?.total_repaid ?? 0);
        if (totalRepaid >= Number(loan.principal_amount)) {
            await db.runAsync("UPDATE loans SET status = 'SETTLED' WHERE id = ?;", [params.loanId]);
        }

        return {
            id: repaymentId,
            loanId: params.loanId,
            transactionId: txId,
            principalRepaid: params.principalRepaid,
            interestPaid: params.interestPaid ?? 0,
            feePaid: params.feePaid ?? 0,
            repaymentDate: params.repaymentDate,
            notes: params.notes,
            createdAt: now,
        };
    });
}

export async function getLoansDB(): Promise<LoanWithDetails[]> {
    const db = await getDatabase();
    const loans = await db.getAllAsync<LoanRow>('SELECT * FROM loans ORDER BY created_at DESC;');
    if (loans.length === 0) return [];

    const repayments = await db.getAllAsync<LoanRepaymentRow>(
        'SELECT * FROM loan_repayments ORDER BY repayment_date ASC;'
    );

    return loans.map((loan) => {
        const loanReps = repayments
            .filter((r) => r.loan_id === loan.id)
            .map((r) => ({
                id: r.id,
                loanId: r.loan_id,
                transactionId: r.transaction_id || undefined,
                principalRepaid: Number(r.principal_repaid),
                interestPaid: Number(r.interest_paid),
                feePaid: Number(r.fee_paid),
                repaymentDate: r.repayment_date,
                notes: r.notes || undefined,
                createdAt: r.created_at,
            }));

        const totalPrincipalRepaid = loanReps.reduce((sum, r) => sum + r.principalRepaid, 0);
        const totalInterestPaid = loanReps.reduce((sum, r) => sum + r.interestPaid, 0);
        const totalFeePaid = loanReps.reduce((sum, r) => sum + r.feePaid, 0);
        const remainingPrincipal = Math.max(0, Number(loan.principal_amount) - totalPrincipalRepaid);

        return {
            id: loan.id,
            type: loan.type,
            counterparty: loan.counterparty,
            principalAmount: Number(loan.principal_amount),
            disbursementTransactionId: loan.disbursement_transaction_id || undefined,
            walletId: loan.wallet_id || undefined,
            interestRate: loan.interest_rate != null ? Number(loan.interest_rate) : undefined,
            dueDate: loan.due_date || undefined,
            status: loan.status,
            notes: loan.notes || undefined,
            createdAt: loan.created_at,
            repayments: loanReps,
            totalPrincipalRepaid,
            totalInterestPaid,
            totalFeePaid,
            remainingPrincipal,
        };
    });
}

// 5. Merchants & Rules
export async function saveMerchantDB(
    merchant: Omit<Merchant, 'createdAt'> & { createdAt?: string }
): Promise<Merchant> {
    const now = merchant.createdAt || new Date().toISOString();
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            `INSERT INTO merchants (id, name, normalized_name, merchant_type, default_category_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(normalized_name) DO UPDATE SET
                name = excluded.name,
                merchant_type = excluded.merchant_type,
                default_category_id = excluded.default_category_id;`,
            [
                merchant.id,
                merchant.name.trim(),
                merchant.normalizedName.trim(),
                merchant.merchantType ?? null,
                merchant.defaultCategoryId ?? null,
                now,
            ]
        );
    });
    return { ...merchant, createdAt: now };
}

export async function getMerchantsDB(): Promise<Merchant[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<MerchantRow>('SELECT * FROM merchants ORDER BY name ASC;');
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        normalizedName: r.normalized_name,
        merchantType: (r.merchant_type as Merchant['merchantType']) || undefined,
        defaultCategoryId: r.default_category_id || undefined,
        createdAt: r.created_at,
    }));
}

export async function saveMerchantRuleDB(
    rule: Omit<MerchantRule, 'createdAt'> & { createdAt?: string }
): Promise<MerchantRule> {
    const now = rule.createdAt || new Date().toISOString();
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            `INSERT INTO merchant_rules (id, pattern, merchant_id, category_id, auto_apply, created_at)
            VALUES (?, ?, ?, ?, ?, ?);`,
            [rule.id, rule.pattern.toLowerCase().trim(), rule.merchantId, rule.categoryId, rule.autoApply ? 1 : 0, now]
        );
    });
    return { ...rule, createdAt: now };
}

export async function getMerchantRulesDB(): Promise<MerchantRule[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<MerchantRuleRow>('SELECT * FROM merchant_rules ORDER BY created_at DESC;');
    return rows.map((r) => ({
        id: r.id,
        pattern: r.pattern,
        merchantId: r.merchant_id,
        categoryId: r.category_id,
        autoApply: Boolean(r.auto_apply),
        createdAt: r.created_at,
    }));
}

export async function addMerchantAliasDB(alias: string, merchantId: string): Promise<MerchantAlias> {
    const now = new Date().toISOString();
    const id = `alias-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            'INSERT OR IGNORE INTO merchant_aliases (id, alias, merchant_id, created_at) VALUES (?, ?, ?, ?);',
            [id, alias.trim(), merchantId, now]
        );
    });
    return { id, alias: alias.trim(), merchantId, createdAt: now };
}

// 6. Education Institutions & Commitments
export async function saveEducationInstitutionDB(
    inst: Omit<EducationInstitution, 'createdAt'> & { createdAt?: string }
): Promise<EducationInstitution> {
    const now = inst.createdAt || new Date().toISOString();
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            `INSERT INTO education_institutions (id, name, normalized_name, default_category_id, preferred_frequency, preferred_fee_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(normalized_name) DO UPDATE SET
                default_category_id = excluded.default_category_id,
                preferred_frequency = excluded.preferred_frequency,
                preferred_fee_type = excluded.preferred_fee_type;`,
            [
                inst.id,
                inst.name.trim(),
                inst.normalizedName.trim(),
                inst.defaultCategoryId ?? null,
                inst.preferredFrequency || 'Semester',
                inst.preferredFeeType || 'Tuition',
                now,
            ]
        );
    });
    return { ...inst, createdAt: now };
}

export async function getEducationInstitutionsDB(): Promise<EducationInstitution[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<EducationInstitutionRow>('SELECT * FROM education_institutions ORDER BY name ASC;');
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        normalizedName: r.normalized_name,
        defaultCategoryId: r.default_category_id || undefined,
        preferredFrequency: (r.preferred_frequency as EducationInstitution['preferredFrequency']) || 'Semester',
        preferredFeeType: (r.preferred_fee_type as EducationInstitution['preferredFeeType']) || 'Tuition',
        createdAt: r.created_at,
    }));
}

export async function saveEducationCommitmentDB(
    commitment: Omit<EducationCommitment, 'createdAt'> & { createdAt?: string }
): Promise<EducationCommitment> {
    const now = commitment.createdAt || new Date().toISOString();
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            `INSERT INTO education_commitments (id, institution_id, student_name, fee_type, frequency, expected_amount, academic_term, academic_year, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                commitment.id,
                commitment.institutionId,
                commitment.studentName ?? null,
                commitment.feeType || 'Tuition',
                commitment.frequency || 'Semester',
                commitment.expectedAmount ?? null,
                commitment.academicTerm ?? null,
                commitment.academicYear ?? null,
                now,
            ]
        );
    });
    return { ...commitment, createdAt: now };
}

export async function getEducationCommitmentsDB(): Promise<EducationCommitment[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<EducationCommitmentRow>('SELECT * FROM education_commitments ORDER BY created_at DESC;');
    return rows.map((r) => ({
        id: r.id,
        institutionId: r.institution_id,
        studentName: r.student_name || undefined,
        feeType: (r.fee_type as EducationCommitment['feeType']) || 'Tuition',
        frequency: (r.frequency as EducationCommitment['frequency']) || 'Semester',
        expectedAmount: r.expected_amount != null ? Number(r.expected_amount) : undefined,
        academicTerm: r.academic_term || undefined,
        academicYear: r.academic_year || undefined,
        createdAt: r.created_at,
    }));
}

// 7. Bill Confirmations
export async function insertBillConfirmationDB(
    conf: Omit<BillConfirmation, 'createdAt'> & { createdAt?: string }
): Promise<BillConfirmation> {
    const now = conf.createdAt || new Date().toISOString();
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            `INSERT INTO bill_confirmations
            (id, biller_name, account_number, bill_reference, amount, confirmation_code, raw_message, message_date, status, matched_transaction_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                conf.id,
                conf.billerName,
                conf.accountNumber ?? null,
                conf.billReference ?? null,
                conf.amount,
                conf.confirmationCode ?? null,
                conf.rawMessage ?? null,
                conf.messageDate,
                conf.status,
                conf.matchedTransactionId ?? null,
                now,
            ]
        );
    });
    return { ...conf, createdAt: now };
}

export async function getBillConfirmationsDB(): Promise<BillConfirmation[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<BillConfirmationRow>('SELECT * FROM bill_confirmations ORDER BY message_date DESC;');
    return rows.map((r) => ({
        id: r.id,
        billerName: r.biller_name,
        accountNumber: r.account_number || undefined,
        billReference: r.bill_reference || undefined,
        amount: Number(r.amount),
        confirmationCode: r.confirmation_code || undefined,
        rawMessage: r.raw_message || undefined,
        messageDate: r.message_date,
        status: r.status,
        matchedTransactionId: r.matched_transaction_id || undefined,
        createdAt: r.created_at,
    }));
}

export async function linkBillConfirmationDB(confirmationId: string, transactionId: string): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            "UPDATE bill_confirmations SET status = 'MATCHED', matched_transaction_id = ? WHERE id = ?;",
            [transactionId, confirmationId]
        );
    });
}

// 8. Telecom Packages & Events
export async function insertTelecomEventDB(
    event: Omit<TelecomEvent, 'createdAt'> & { createdAt?: string }
): Promise<TelecomEvent> {
    const now = event.createdAt || new Date().toISOString();
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            `INSERT INTO telecom_events
            (id, package_instance_id, package_name, event_type, event_time, price, transaction_id, volume_text, usage_percentage, expiry_time, raw_sms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                event.id,
                event.packageInstanceId ?? null,
                event.packageName,
                event.eventType,
                event.eventTime,
                event.price ?? null,
                event.transactionId ?? null,
                event.volumeText ?? null,
                event.usagePercentage ?? null,
                event.expiryTime ?? null,
                event.rawSms ?? null,
                now,
            ]
        );
    });
    return { ...event, createdAt: now };
}

export async function getTelecomEventsDB(): Promise<TelecomEvent[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TelecomEventRow>('SELECT * FROM telecom_events ORDER BY event_time DESC, created_at DESC;');
    return rows.map((r) => ({
        id: r.id,
        packageInstanceId: r.package_instance_id || undefined,
        packageName: r.package_name,
        eventType: r.event_type,
        eventTime: r.event_time,
        price: r.price != null ? Number(r.price) : undefined,
        transactionId: r.transaction_id || undefined,
        volumeText: r.volume_text || undefined,
        usagePercentage: r.usage_percentage != null ? Number(r.usage_percentage) : undefined,
        expiryTime: r.expiry_time || undefined,
        rawSms: r.raw_sms || undefined,
        createdAt: r.created_at,
    }));
}

export async function saveTelecomPackageDB(
    pkg: Omit<TelecomPackage, 'createdAt'> & { createdAt?: string }
): Promise<TelecomPackage> {
    const now = pkg.createdAt || new Date().toISOString();
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            `INSERT INTO telecom_packages
            (id, package_name, category, volume_mb, sms_count, voice_minutes, validity_period, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                pkg.id,
                pkg.packageName,
                pkg.category,
                pkg.volumeMb ?? null,
                pkg.smsCount ?? null,
                pkg.voiceMinutes ?? null,
                pkg.validityPeriod ?? null,
                pkg.isActive ? 1 : 0,
                now,
            ]
        );
    });
    return { ...pkg, createdAt: now };
}

export async function getTelecomPackagesDB(): Promise<TelecomPackage[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TelecomPackageRow>('SELECT * FROM telecom_packages ORDER BY package_name ASC;');
    return rows.map((r) => ({
        id: r.id,
        packageName: r.package_name,
        category: r.category,
        volumeMb: r.volume_mb != null ? Number(r.volume_mb) : undefined,
        smsCount: r.sms_count != null ? Number(r.sms_count) : undefined,
        voiceMinutes: r.voice_minutes != null ? Number(r.voice_minutes) : undefined,
        validityPeriod: r.validity_period || undefined,
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
    }));
}

// 9. Recurring Commitments
export async function saveRecurringCommitmentDB(
    commitment: Omit<RecurringCommitment, 'createdAt'> & { createdAt?: string }
): Promise<RecurringCommitment> {
    const now = commitment.createdAt || new Date().toISOString();
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            `INSERT INTO recurring_commitments
            (id, name, commitment_type, category_id, expected_amount, is_variable_amount, frequency, billing_day, next_expected_date, status, merchant_id, institution_id, wallet_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                commitment_type = excluded.commitment_type,
                category_id = excluded.category_id,
                expected_amount = excluded.expected_amount,
                is_variable_amount = excluded.is_variable_amount,
                frequency = excluded.frequency,
                billing_day = excluded.billing_day,
                next_expected_date = excluded.next_expected_date,
                status = excluded.status,
                merchant_id = excluded.merchant_id,
                institution_id = excluded.institution_id,
                wallet_id = excluded.wallet_id;`,
            [
                commitment.id,
                commitment.name.trim(),
                commitment.commitmentType,
                commitment.categoryId,
                commitment.expectedAmount ?? null,
                commitment.isVariableAmount ? 1 : 0,
                commitment.frequency,
                commitment.billingDay ?? null,
                commitment.nextExpectedDate ?? null,
                commitment.status || 'OBSERVED',
                commitment.merchantId ?? null,
                commitment.institutionId ?? null,
                commitment.walletId ?? null,
                now,
            ]
        );
    });
    return { ...commitment, createdAt: now };
}

export async function getRecurringCommitmentsDB(): Promise<RecurringCommitment[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<RecurringCommitmentRow>('SELECT * FROM recurring_commitments ORDER BY name ASC;');
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        commitmentType: r.commitment_type as RecurringCommitment['commitmentType'],
        categoryId: r.category_id,
        expectedAmount: r.expected_amount != null ? Number(r.expected_amount) : undefined,
        isVariableAmount: Boolean(r.is_variable_amount),
        frequency: r.frequency as RecurringCommitment['frequency'],
        billingDay: r.billing_day != null ? Number(r.billing_day) : undefined,
        nextExpectedDate: r.next_expected_date || undefined,
        status: r.status,
        merchantId: r.merchant_id || undefined,
        institutionId: r.institution_id || undefined,
        walletId: r.wallet_id || undefined,
        createdAt: r.created_at,
    }));
}

export async function updateRecurringCommitmentStatusDB(id: string, status: CommitmentStatus): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        await db.runAsync('UPDATE recurring_commitments SET status = ? WHERE id = ?;', [status, id]);
    });
}

// ---------------------------------------------------------------------------
// Known Accounts Registry & Wallet Balance Reconciliation
// ---------------------------------------------------------------------------

export async function getKnownAccountsDB(): Promise<KnownAccount[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<KnownAccountRow>('SELECT * FROM known_accounts ORDER BY display_name ASC;');
    return rows.map((r) => ({
        id: r.id,
        walletId: r.wallet_id || undefined,
        providerId: r.provider_id,
        accountType: r.account_type as KnownAccount['accountType'],
        accountNumber: r.account_number,
        accountLast4: r.account_last4 || undefined,
        displayName: r.display_name,
        maskedIdentifier: r.masked_identifier,
        ownership: r.ownership,
        createdAt: r.created_at,
    }));
}

export async function saveKnownAccountDB(account: KnownAccount): Promise<KnownAccount> {
    const now = account.createdAt || new Date().toISOString();
    await withExclusiveTransaction(async (db) => {
        await db.runAsync(
            `INSERT INTO known_accounts
            (id, wallet_id, provider_id, account_type, account_number, account_last4, display_name, masked_identifier, ownership, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                wallet_id = excluded.wallet_id,
                provider_id = excluded.provider_id,
                account_type = excluded.account_type,
                account_number = excluded.account_number,
                account_last4 = excluded.account_last4,
                display_name = excluded.display_name,
                masked_identifier = excluded.masked_identifier,
                ownership = excluded.ownership;`,
            [
                account.id,
                account.walletId ?? null,
                account.providerId,
                account.accountType,
                account.accountNumber,
                account.accountLast4 ?? null,
                account.displayName,
                account.maskedIdentifier,
                account.ownership,
                now,
            ]
        );
    });
    return { ...account, createdAt: now };
}

export async function deleteKnownAccountDB(id: string): Promise<void> {
    await withExclusiveTransaction(async (db) => {
        await db.runAsync('DELETE FROM known_accounts WHERE id = ?;', [id]);
    });
}

export async function reconcileWalletBalanceDB(walletId: string, currentBalance: number): Promise<void> {
    if (!Number.isFinite(currentBalance)) return;
    await withExclusiveTransaction(async (db) => {
        // SMS snapshots are evidence on their transactions, never an opening-balance adjustment.
        await db.runAsync(`UPDATE wallets SET balance = ${ledgerBalance()} WHERE id = ?;`, [walletId]);
    });
}



/** One atomic handoff: principal, fees, wallet delta and receipt commit together. */
export async function applySmsImportPlanDB(messageId: string, plan: ImportPlan): Promise<'imported' | 'duplicate'> {
    if (plan.status !== 'imported' || !plan.transaction) throw new Error('A valid financial plan is required');
    return withExclusiveTransaction(db => applySmsPlan(db,messageId,plan));
}
async function saveCbeBalanceCheckpoint(db:SQLite.SQLiteDatabase,plan:ImportPlan):Promise<void> {
    const c=plan.balanceCheckpoint;if(!c)return;
    if(plan.candidate?.providerId!=='cbe'||!Number.isSafeInteger(c.balanceMinor)||c.balanceMinor<0)throw Error('Invalid CBE bank checkpoint.');
    const conflict=await db.getFirstAsync<{id:string}>('SELECT id FROM cbe_balance_checkpoints WHERE wallet_id=? AND observed_at=? AND balance_minor<>? LIMIT 1',[c.walletId,c.observedAt,c.balanceMinor]);
    if(conflict)throw Error('Conflicting CBE balances share the same event time. Confirm the original dates before using a bank balance.');
    await db.runAsync('INSERT OR IGNORE INTO cbe_balance_checkpoints(id,wallet_id,account_last4,balance_minor,observed_at,received_at,date_source,date_precision) VALUES(?,?,?,?,?,?,?,?)',[c.id,c.walletId,c.accountLast4,c.balanceMinor,c.observedAt,c.receivedAt,c.dateSource,c.datePrecision]);
}
async function applySmsPlan(db: SQLite.SQLiteDatabase, messageId: string, plan: ImportPlan): Promise<'imported' | 'duplicate'> {
        if(plan.candidate?.providerId==='cbe' && (!plan.normalized || !plan.transaction?.smsDetails))throw Error('CBE canonical financial validation is required.');
        assertValidTransaction(plan.transaction!);
        await assertTransactionReferences(db,plan.transaction!);
        if(plan.candidate?.providerId==='cbe')for(const entry of plan.entries ?? []){assertValidTransaction(entry);await assertTransactionReferences(db,entry);}
        const receipt = await db.getFirstAsync<{transaction_id:string}>('SELECT transaction_id FROM sms_import_receipts WHERE message_key = ?;', [messageId]);
        if (receipt) {await assertCbeDuplicateConsistent(db,receipt.transaction_id,plan);return 'duplicate';}
        const query = duplicateQuery(plan);
        const existing = await db.getFirstAsync<{id: string}>(query.sql, query.params);
        if (existing) {
            await assertCbeDuplicateConsistent(db,existing.id,plan);
            await db.runAsync('INSERT INTO sms_import_receipts(message_key, transaction_id, created_at) VALUES (?, ?, ?);',
                [messageId, existing.id, new Date().toISOString()]);
            return 'duplicate';
        }
        for (const command of plan.commands) await db.runAsync(command.sql, command.params);
        await saveCbeBalanceCheckpoint(db,plan);
        return 'imported';
}

/** Existing bad imports are retained for reconciliation, never silently acknowledged
 * as financially correct and never "fixed" by adding a second transaction. */
async function assertCbeDuplicateConsistent(db:SQLite.SQLiteDatabase,id:string,plan:ImportPlan):Promise<void> {
    if(plan.candidate?.providerId!=='cbe' || !plan.normalized)return;
    const existing=await db.getFirstAsync<TransactionRow>('SELECT * FROM transactions WHERE id=?',[id]);
    if(!existing)return; // A durable receipt also preserves an intentional deletion.
    let impact=existing.amount_minor ?? Math.round(existing.amount*100);
    if(existing.type==='DEBIT') {
        const fee=await db.getFirstAsync<{amount:number;amount_minor:number|null}>(`SELECT amount,amount_minor FROM transactions WHERE id=? OR id=(SELECT fee_transaction_id FROM transfers WHERE from_transaction_id=? LIMIT 1) LIMIT 1`,[`${id}-fee`,id]);
        if(fee)impact+=fee.amount_minor ?? Math.round(fee.amount*100);
    }
    if(impact!==plan.normalized.ledgerAmountMinor)throw Error('CBE existing entry conflicts with the verified account impact. Reconcile the original entry before importing.');
}

export interface SmsBatchOutcome { id: string; status: 'imported' | 'duplicate' | 'review' | 'skipped' | 'failed'; reason: string }
/** One durable commit per bounded batch; savepoints isolate malformed messages from valid neighbours. */
export async function applySmsProcessingBatchDB(items: { id: string; plan: ImportPlan }[], evidenceInbox = false): Promise<SmsBatchOutcome[]> {
    if (items.length > 40) throw Error('Process at most 40 messages per ledger batch.');
    return withExclusiveTransaction(async db => {
        const outcomes: SmsBatchOutcome[] = [];
        for (const item of items) {
            await db.execAsync('SAVEPOINT sms_message;');
            let outcome: SmsBatchOutcome;
            try {
                const exists = await db.getFirstAsync('SELECT 1 FROM sms_import_receipts WHERE message_key=?',[item.id]);
                const status = item.plan.status === 'imported' && item.plan.candidate?.providerId==='cbe' ? await applySmsPlan(db,item.id,item.plan) : exists ? 'duplicate' : item.plan.status === 'imported' ? await applySmsPlan(db,item.id,item.plan) : item.plan.status;
                if(status==='review')await saveCbeBalanceCheckpoint(db,item.plan);
                outcome = { id:item.id,status,reason:exists ? 'Already in the ledger' : item.plan.reason };
                await db.execAsync('RELEASE sms_message;');
            } catch (error) {
                await db.execAsync('ROLLBACK TO sms_message; RELEASE sms_message;');
                outcome = error instanceof Error && error.message.startsWith('CBE existing entry conflicts')
                    ? {id:item.id,status:'review',reason:error.message}
                    : { id:item.id,status:'failed',reason:'Local processing failed. Your message remains queued for retry.' };
            }
            if (evidenceInbox) await db.runAsync(`UPDATE scriptable_sms_inbox SET status=?,reason=?,body=CASE WHEN ? IN ('imported','duplicate','skipped') THEN '' ELSE body END WHERE message_key=?`,
                [outcome.status === 'skipped' ? 'dismissed' : outcome.status,outcome.reason,outcome.status,item.id]);
            outcomes.push(outcome);
        }
        return outcomes;
    });
}

export async function hasSmsImportReceiptDB(messageKey: string): Promise<boolean> {
    return !!await (await getDatabase()).getFirstAsync('SELECT message_key FROM sms_import_receipts WHERE message_key=?;', [messageKey]);
}

export async function getSmsTransactionCountDB(): Promise<number> {
    const row = await (await getDatabase()).getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM transactions WHERE source='sms';");
    return row?.count ?? 0;
}

/** Stage evidence before parsing. Financial writes still use the existing atomic SMS/transfer APIs. */
export async function stageScriptableMessagesDB(rows: { id: string; body: string; sender: string; receivedAt: number }[], batchId: string): Promise<void> {
    await withExclusiveTransaction(async db => {
        for (const row of rows) await db.runAsync(`INSERT OR IGNORE INTO scriptable_sms_inbox
            (message_key,body,sender,received_at,status,batch_id,created_at) VALUES(?,?,?,?,'pending',?,?);`,
            [row.id,row.body,row.sender,row.receivedAt,batchId,new Date().toISOString()]);
    });
}
export async function getScriptableInboxDB(limit = 50): Promise<InboxRow[]> {
    return (await getDatabase()).getAllAsync<InboxRow>(`SELECT message_key AS id,body,sender,received_at AS receivedAt,status,reason
        FROM scriptable_sms_inbox WHERE status IN ('pending','review','failed') ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,received_at DESC,message_key LIMIT ?;`, [Math.min(Math.max(limit,1),10000)]);
}
export async function getScriptableMessagesDB(ids: string[]): Promise<InboxRow[]> {
    if (!ids.length) return [];
    if (ids.length > 200) throw Error('Read companion evidence in bounded batches');
    return (await getDatabase()).getAllAsync<InboxRow>(`SELECT message_key AS id,body,sender,received_at AS receivedAt,status,reason FROM scriptable_sms_inbox WHERE message_key IN (${ids.map(()=>'?').join(',')});`,ids);
}
export async function scriptableInboxCountsDB(): Promise<Record<string,number>> {
    const rows = await (await getDatabase()).getAllAsync<{status:string;count:number}>('SELECT status,COUNT(*) AS count FROM scriptable_sms_inbox GROUP BY status;');
    return Object.fromEntries(rows.map(row=>[row.status,row.count]));
}
export async function finishScriptableMessageDB(id: string, status: InboxRow['status'], reason: string): Promise<void> {
    if (!['pending','review','failed','imported','duplicate','dismissed'].includes(status)) throw Error('Invalid inbox status');
    const terminal = ['imported','duplicate','dismissed'].includes(status);
    await withExclusiveTransaction(async db => {
        await db.runAsync('UPDATE scriptable_sms_inbox SET status=?,reason=?,body=CASE WHEN ? THEN \'\' ELSE body END WHERE message_key=?;', [status,reason.slice(0,600),terminal?1:0,id]);
    });
}

/** Called only after local PIN verification and explicit destructive confirmation. */
export async function wipeVaultDB(userId:string):Promise<void> {
    await withExclusiveTransaction(async db=>{
        const active=await db.getFirstAsync<{id:string}>('SELECT id FROM users LIMIT 1');
        if(!active || active.id!==userId)throw Error('Unlock the current vault before erasing it.');
        await db.execAsync('PRAGMA secure_delete=ON; PRAGMA defer_foreign_keys=ON;');
        await db.runAsync('UPDATE wallets SET is_default=0');
        for(const table of [...FINANCIAL_TABLES].reverse())if(!['wallets','categories','transactions'].includes(table))await db.runAsync(`DELETE FROM ${table}`);
        await db.runAsync('DELETE FROM transactions');await db.runAsync('DELETE FROM wallets');
        await db.runAsync('DELETE FROM categories WHERE is_built_in=0');await db.runAsync('DELETE FROM users');
        await seedInitialData(db);
    });
}
