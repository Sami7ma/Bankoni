// Local-first SQLite repository for BanKoni.
// Production startup intentionally does not insert sample transactions or budgets.

import * as SQLite from 'expo-sqlite';
import type { Transaction } from '../types/Transaction';
import type { Budget } from '../types/Budget';
import type { Category } from '../types/Category';
import type { Wallet } from '../types/Wallet';
import type { User, ExportDataPayload } from '../types/User';
import { defaultCategories } from '../constants/defaultCategories';

const DB_NAME = 'bankoni.db';
const DATABASE_VERSION = 3;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
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
    const db = await getDatabase();
    let result!: T;
    await db.withExclusiveTransactionAsync(async (transaction) => {
        result = await work(transaction as unknown as SQLite.SQLiteDatabase);
    });
    return result;
}

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (!dbPromise) {
        dbPromise = SQLite.openDatabaseAsync(DB_NAME).catch((error) => {
            // Allow a later retry if opening the database failed the first time.
            dbPromise = null;
            throw error;
        });
    }
    return dbPromise;
}

const SCHEMA_SQL = `
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
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    limit_amount REAL NOT NULL CHECK (limit_amount >= 0),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    recurring TEXT DEFAULT 'monthly',
    alert_threshold REAL DEFAULT 0.8 CHECK (alert_threshold IS NULL OR (alert_threshold >= 0 AND alert_threshold <= 1))
  );

  CREATE TABLE IF NOT EXISTS auth_security (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
    lockout_until_ms INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO auth_security (id, failed_pin_attempts, lockout_until_ms) VALUES (1, 0, 0);

  CREATE INDEX IF NOT EXISTS idx_transactions_date_created
    ON transactions(date DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_id);
  CREATE INDEX IF NOT EXISTS idx_budgets_category ON budgets(category_id);

  -- These guards complement PRAGMA foreign_keys. Expo's exclusive transaction
  -- path can use a separate SQLite connection, so correctness must not rely on
  -- a connection-local PRAGMA alone.
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
    const db = await getDatabase();
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

    await db.withExclusiveTransactionAsync(async (rawTransaction) => {
        const tx = rawTransaction as unknown as SQLite.SQLiteDatabase;
        const versionRow = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
        const previousVersion = Number(versionRow?.user_version ?? 0);
        if (previousVersion > DATABASE_VERSION) {
            throw new Error(`This BanKoni database schema (version ${previousVersion}) is newer than this app supports.`);
        }

        await tx.execAsync(SCHEMA_SQL);

        // The original app's schema did not scope records to a user. Fail closed if
        // an old database already contains multiple profiles; silently selecting
        // one could expose the wrong person's financial records.
        const userCount = await tx.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) AS count FROM users;',
        );
        if ((userCount?.count ?? 0) > 1) {
            throw new Error(
                'This database contains more than one vault profile. BanKoni stopped to protect your records. Back up the database and resolve the profiles before retrying.',
            );
        }

        // A constant-expression unique index enforces one vault per installation.
        await tx.execAsync(
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_profile ON users ((1));',
        );

        await normalizeDefaultWallet(tx);

        // Before this version, transaction CRUD did not update wallet balances.
        // Reconcile each wallet exactly once as part of the versioned migration.
        // The migration is committed with PRAGMA user_version so it cannot be
        // applied twice after a successful commit.
        if (previousVersion < 2) {
            await reconcileWalletBalances(tx);
        }

        if (previousVersion < 3) {
            await migrateToVersion3(tx);
        }

        await seedInitialData(tx);
        await tx.execAsync(
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_single_default ON wallets(is_default) WHERE is_default = 1;',
        );
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

async function reconcileWalletBalances(db: SQLite.SQLiteDatabase): Promise<void> {
    const rows = await db.getAllAsync<{ wallet_id: string; net: number | null }>(`
    SELECT wallet_id,
      SUM(CASE
        WHEN status <> 'CLEARED' THEN 0
        WHEN type = 'CREDIT' THEN amount
        ELSE -amount
      END) AS net
    FROM transactions
    GROUP BY wallet_id;
  `);

    for (const row of rows) {
        const net = Number(row.net ?? 0);
        if (Number.isFinite(net) && net !== 0) {
            await db.runAsync('UPDATE wallets SET balance = balance + ? WHERE id = ?;', [net, row.wallet_id]);
        }
    }
}

async function migrateToVersion3(db: SQLite.SQLiteDatabase): Promise<void> {
    // 1. Ensure new wallet columns exist (idempotent ALTER TABLE checks)
    const tableInfo = await db.getAllAsync<{ name: string }>('PRAGMA table_info(wallets);');
    const existingCols = new Set(tableInfo.map((col) => col.name.toLowerCase()));

    if (!existingCols.has('provider_id')) {
        await db.runAsync("ALTER TABLE wallets ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'custom';");
    }
    if (!existingCols.has('opening_balance')) {
        await db.runAsync('ALTER TABLE wallets ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0.0;');
    }
    if (!existingCols.has('account_number_last4')) {
        await db.runAsync('ALTER TABLE wallets ADD COLUMN account_number_last4 TEXT;');
    }
    if (!existingCols.has('is_archived')) {
        await db.runAsync('ALTER TABLE wallets ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;');
    }

    // 2. Identify all wallets and reconcile with the strict balance invariant:
    //    balance = opening_balance + sum(cleared credits) - sum(cleared debits)
    //    For the known legacy seeded wallet ('wallet-1'), the hardcoded ETB 12,450
    //    starting balance was fabricated; set its legitimate opening_balance to 0.0
    //    and recompute its balance solely from real user transactions.
    const wallets = await db.getAllAsync<{ id: string; name: string; balance: number; opening_balance: number | null }>(
        'SELECT id, name, balance, opening_balance FROM wallets;',
    );

    for (const w of wallets) {
        const netRow = await db.getFirstAsync<{ net: number | null }>(`
            SELECT SUM(CASE
                WHEN status <> 'CLEARED' THEN 0
                WHEN type = 'CREDIT' THEN amount
                ELSE -amount
            END) AS net
            FROM transactions
            WHERE wallet_id = ?;
        `, [w.id]);
        const netTransactions = Number(netRow?.net ?? 0);

        let legitimateOpening = Number(w.opening_balance ?? 0);

        if (w.id === 'wallet-1' || w.id === 'wallet-cash-default') {
            legitimateOpening = 0.0;
            await db.runAsync(
                "UPDATE wallets SET provider_id = 'cash' WHERE id = ? AND (provider_id = 'custom' OR provider_id IS NULL);",
                [w.id],
            );
        }

        const reconciledBalance = legitimateOpening + netTransactions;

        await db.runAsync(
            'UPDATE wallets SET opening_balance = ?, balance = ? WHERE id = ?;',
            [legitimateOpening, reconciledBalance, w.id],
        );
    }
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
        type: row.type,
        categoryId: row.category_id,
        note: row.note || '',
        date: row.date,
        status: row.status,
        walletId: row.wallet_id,
        currentBalance: row.current_balance == null ? undefined : Number(row.current_balance),
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
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) {
        throw new Error('Transaction amount must be a finite number greater than zero.');
    }
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

    const wallet = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM wallets WHERE id = ?;',
        [tx.walletId],
    );
    if (!wallet) throw new Error('The selected wallet no longer exists.');
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
    const db = await getDatabase();
    const result = await db.runAsync('UPDATE users SET pin_hash = ? WHERE id = ?;', [pinHash, userId]);
    if (result.changes !== 1) throw new Error('The stored vault profile could not be updated.');
}

export async function setBiometricEnabledDB(userId: string, enabled: boolean): Promise<void> {
    const db = await getDatabase();
    const result = await db.runAsync(
        'UPDATE users SET is_biometric_enabled = ? WHERE id = ?;',
        [enabled ? 1 : 0, userId],
    );
    if (result.changes !== 1) throw new Error('The vault profile could not be updated.');
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

    const db = await getDatabase();

    const result = await db.runAsync(
        'UPDATE users SET name = ?, email = ? WHERE id = ?;',
        [cleanName, cleanEmail, userId],
    );

    if (result.changes !== 1) {
        throw new Error('The local vault profile could not be updated.');
    }
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
    const db = await getDatabase();
    await db.runAsync(
        'UPDATE auth_security SET failed_pin_attempts = 0, lockout_until_ms = 0 WHERE id = 1;',
    );
}

// Transactions

export async function getTransactionsDB(): Promise<Transaction[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TransactionRow>(
        'SELECT * FROM transactions ORDER BY date DESC, created_at DESC;',
    );
    return rows.map(mapTransaction);
}

export async function insertTransactionDB(tx: Transaction): Promise<void> {
    assertValidTransaction(tx);
    await withExclusiveTransaction(async (db) => {
        await assertTransactionReferences(db, tx);
        await db.runAsync(
            `INSERT INTO transactions
        (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source, raw_sms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, ?);`,
            [
                tx.id,
                tx.amount,
                tx.type,
                tx.categoryId,
                tx.note || '',
                tx.date,
                tx.status,
                tx.walletId,
                tx.currentBalance ?? null,
                tx.createdAt,
            ],
        );

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
    if (updated.date !== undefined) { fields.push('date = ?'); values.push(updated.date); }
    if (updated.status !== undefined) { fields.push('status = ?'); values.push(updated.status); }
    if (updated.walletId !== undefined) { fields.push('wallet_id = ?'); values.push(updated.walletId); }
    if (updated.currentBalance !== undefined) { fields.push('current_balance = ?'); values.push(updated.currentBalance); }
    if (fields.length === 0) return;

    await withExclusiveTransaction(async (db) => {
        const oldRow = await db.getFirstAsync<TransactionRow>(
            'SELECT * FROM transactions WHERE id = ?;',
            [id],
        );
        if (!oldRow) throw new Error('Transaction not found. It may already have been deleted.');

        const oldTransaction = mapTransaction(oldRow);
        const nextTransaction: Transaction = { ...oldTransaction, ...updated };
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
    const db = await getDatabase();
    await assertBudgetCategory(db, budget);
    await db.runAsync(
        `INSERT INTO budgets (id, category_id, limit_amount, start_date, end_date, recurring, alert_threshold)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
            budget.id,
            budget.categoryId,
            budget.limitAmount,
            budget.startDate,
            budget.endDate,
            budget.recurring || 'monthly',
            budget.alertThreshold ?? 0.8,
        ],
    );
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
    const db = await getDatabase();
    await db.runAsync('DELETE FROM budgets WHERE id = ?;', [id]);
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
    const db = await getDatabase();
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
        ? 'SELECT * FROM wallets ORDER BY is_archived ASC, is_default DESC, created_at ASC;'
        : 'SELECT * FROM wallets WHERE is_archived = 0 ORDER BY is_default DESC, created_at ASC;';
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

export async function exportDatabaseToJSON(): Promise<ExportDataPayload> {
    const userRow = await getActiveUserDB();
    const [wallets, categories, budgets, transactions] = await Promise.all([
        getWalletsDB(),
        getCategoriesDB(),
        getBudgetsDB(),
        getTransactionsDB(),
    ]);

    const etbWalletIds = new Set(wallets.filter((wallet) => wallet.currency === 'ETB').map((wallet) => wallet.id));
    const etbClearedTransactions = transactions.filter(
        (transaction) => transaction.status === 'CLEARED' && etbWalletIds.has(transaction.walletId),
    );
    const totalIncome = etbClearedTransactions
        .filter((transaction) => transaction.type === 'CREDIT')
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    const totalExpenses = etbClearedTransactions
        .filter((transaction) => transaction.type === 'DEBIT')
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    const totalBalance = wallets
        .filter((wallet) => wallet.currency === 'ETB')
        .reduce((sum, wallet) => sum + wallet.balance, 0);

    return {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        user: userRow?.user ?? null,
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
    };
}
