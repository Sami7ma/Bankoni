import type { SQLiteDatabase } from 'expo-sqlite';
import type { DatabaseReader } from './connectionOwner';
import { LEDGER_COLUMNS } from './ledgerIntegrity';

// Fixed allowlist; a backup can never supply table names, SQL, credentials or schema.
export const FINANCIAL_TABLES = [
    'categories', 'wallets', 'merchants', 'education_institutions', 'transactions', 'budgets',
    'merchant_aliases', 'merchant_rules', 'education_commitments', 'transfers', 'refund_allocations',
    'shared_expenses', 'shared_expense_participants', 'reimbursement_allocations', 'loans', 'loan_repayments',
    'bill_confirmations', 'telecom_packages', 'telecom_events', 'recurring_commitments', 'known_accounts',
    'sms_import_receipts', 'scriptable_sms_inbox', 'cbe_balance_checkpoints',
] as const;
export type FinancialTable = typeof FINANCIAL_TABLES[number];
export type FinancialSnapshot = Record<FinancialTable, Record<string, string | number | null>[]>;

export async function exportFinancialTables(db: DatabaseReader): Promise<FinancialSnapshot> {
    const snapshot = {} as FinancialSnapshot;
    for (const table of FINANCIAL_TABLES) snapshot[table] = await db.getAllAsync(`SELECT * FROM ${table};`);
    return snapshot;
}

export async function restoreFinancialTables(db: SQLiteDatabase, value: unknown): Promise<void> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Backup is missing its financial snapshot.');
    const snapshot = { ...value } as FinancialSnapshot;
    for (const table of FINANCIAL_TABLES) if (Array.isArray(snapshot[table])) snapshot[table]=snapshot[table].map(row=>row && typeof row==='object' && !Array.isArray(row) ? {...row} : row);
    if(!('cbe_balance_checkpoints' in snapshot))(snapshot as FinancialSnapshot).cbe_balance_checkpoints=[];
    const tables = Object.keys(snapshot);
    if (tables.length !== FINANCIAL_TABLES.length || tables.some(table => !FINANCIAL_TABLES.includes(table as FinancialTable))) throw Error('Backup contains an unsupported financial table set.');
    let count = 0;
    const columns = new Map<FinancialTable, string[]>();
    for (const table of FINANCIAL_TABLES) {
        const schema = await db.getAllAsync<{name:string;pk:number;type:string}>(`PRAGMA table_info(${table});`);
        const names = schema.map(column => column.name);
        columns.set(table, names);
        if (!Array.isArray(snapshot[table])) throw Error(`Invalid backup table: ${table}`);
        count += snapshot[table].length;
        if (count > 100000) throw Error('Backup exceeds 100,000 records.');
        for (const row of snapshot[table]) {
            if (table === 'transactions' && row && typeof row === 'object' && ['amount_minor','occurred_at','received_at','imported_at','date_source'].every(key => !(key in row))) {
                // v2 backups made before schema v4 contain exactly the old columns.
                // Unknown or partially supplied columns still fail the strict check below.
                Object.assign(row, { amount_minor: Math.round(Number(row.amount) * 100),
                    occurred_at: Number.isFinite(Date.parse(String(row.date))) ? Date.parse(String(row.date)) : null,
                    received_at: null, imported_at: Number.isFinite(Date.parse(String(row.created_at))) ? Date.parse(String(row.created_at)) : null,
                    date_source: 'legacy' });
            }
            if (table === 'transactions' && row && typeof row === 'object' && !('date_precision' in row) && !('event_date' in row)) Object.assign(row, { date_precision:null, event_date:null });
            if (table === 'wallets' && row && typeof row === 'object' && !('balance_mode' in row)) row.balance_mode='ledger';
            if (table === 'transactions' && row && typeof row === 'object' && !('sms_details' in row)) row.sms_details=null;
            if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== names.length || Object.keys(row).some(key => !names.includes(key))) throw Error(`Invalid backup columns: ${table}`);
            if (Object.values(row).some(item => item !== null && typeof item !== 'string' && typeof item !== 'number' || typeof item === 'number' && !Number.isFinite(item) || typeof item === 'string' && item.length > 100000)) throw Error(`Invalid backup value: ${table}`);
            for (const column of schema) {
                const field = row[column.name];
                if (field === null) continue; // SQL enforces NOT NULL separately.
                const numeric = /INT|REAL|FLOAT|DOUBLE|NUMERIC/i.test(column.type);
                if (numeric ? typeof field !== 'number' : typeof field !== 'string') throw Error(`Invalid backup field type: ${table}.${column.name}`);
                if (/INT/i.test(column.type) && !Number.isSafeInteger(field)) throw Error(`Invalid backup integer: ${table}.${column.name}`);
            }
            for (const column of schema.filter(column => column.pk)) if (typeof row[column.name] !== 'string' || !String(row[column.name]).trim()) throw Error(`Invalid backup identifier: ${table}`);
        }
    }
    if (!snapshot.wallets.length || snapshot.wallets.filter(row => row.is_default === 1 && row.is_archived === 0).length !== 1) throw Error('Backup needs exactly one active default wallet.');
    if (snapshot.wallets.some(row => !String(row.name).trim() || !String(row.currency).trim())) throw Error('Backup contains an unnamed wallet or currency.');
    // Cyclic financial links are checked together at COMMIT, never disabled.
    await db.execAsync('PRAGMA defer_foreign_keys=ON;');
    await db.runAsync('UPDATE wallets SET is_default=0;');
    for (const table of [...FINANCIAL_TABLES].reverse()) {
        if (table !== 'categories' && table !== 'wallets' && table !== 'transactions') await db.runAsync(`DELETE FROM ${table};`);
    }
    await db.runAsync('DELETE FROM transactions;');
    await db.runAsync('DELETE FROM wallets;');
    await db.runAsync('DELETE FROM categories WHERE is_built_in=0;');
    for (const table of FINANCIAL_TABLES) {
        const names = columns.get(table)!;
        for (const row of snapshot[table]) {
            const conflict = table === 'categories' ? ` ON CONFLICT(id) DO UPDATE SET ${names.filter(name => name !== 'id').map(name => `${name}=excluded.${name}`).join(',')}` : '';
            await db.runAsync(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})${conflict};`, names.map(name => row[name]));
        }
    }
    if ((await db.getAllAsync('PRAGMA foreign_key_check;')).length) throw Error('Backup contains broken financial relationships.');
}
