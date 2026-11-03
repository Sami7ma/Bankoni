import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Transaction } from '../../types/Transaction';
import { createSqliteFixture } from './sqliteFixture';

const cash = 'wallet-cash-default';
const date = '2026-11-01T09:00:00.000Z';
function transaction(id: string, overrides: Partial<Transaction> = {}): Transaction {
    return {
        id, amount: 25, type: 'DEBIT', categoryId: 'cat-1', date,
        status: 'CLEARED', walletId: cash, createdAt: date, ...overrides,
    };
}

describe('Database repository (actual host SQLite, Expo open mocked)', () => {
    let fixture: ReturnType<typeof createSqliteFixture>;
    let repository: typeof import('../database');

    beforeEach(() => {
        fixture = createSqliteFixture();
        jest.resetModules();
        jest.doMock('expo-sqlite', () => ({
            openDatabaseAsync: jest.fn(async (name: string, options: unknown) => {
                expect(name).toBe('bankoni.db');
                expect(options).toEqual({ useNewConnection: true });
                return fixture.open();
            }),
        }));
        repository = require('../database');
    });
    afterEach(() => {
        fixture.dispose();
        jest.dontMock('expo-sqlite');
    });

    async function balances() {
        return Object.fromEntries((await repository.getWalletsDB()).map((wallet) => [wallet.id, wallet.balance]));
    }

    it('shares initialization, seeds once and configures every connection before BEGIN', async () => {
        await Promise.all([repository.initDatabase(), repository.initDatabase(), repository.getTransactionsDB()]);
        expect(await repository.getTransactionsDB()).toEqual([]);
        expect(await repository.getBudgetsDB()).toEqual([]);
        expect(await repository.getCategoriesDB()).toHaveLength(20);
        expect(await repository.getWalletsDB()).toHaveLength(1);
        expect(fixture.connections).toHaveLength(2);
        await repository.insertTransactionDB(transaction('valid'));
        await repository.deleteTransactionDB('valid');
        for (const event of fixture.events.filter((event) => event.sql === 'BEGIN IMMEDIATE;')) {
            expect(event.foreignKeys).toBe(1);
            expect(event.inTransaction).toBe(false);
        }
        expect(await (await repository.getDatabase()).getFirstAsync('PRAGMA foreign_keys;'))
            .toEqual({ foreign_keys: 1 });
        expect(fixture.connections.slice(1).every((connection) => connection.closed)).toBe(true);
    });

    it('rolls back a failed schema/seed initialization and retries safely', async () => {
        let seeded = 0;
        fixture.setIntercept((event) => {
            if (event.sql.includes('INSERT OR IGNORE INTO categories') && ++seeded === 2) {
                throw new Error('seed failure');
            }
        });
        await expect(repository.initDatabase()).rejects.toThrow('seed failure');
        expect(fixture.connections[0].native.prepare("SELECT name FROM sqlite_master WHERE type = 'table';").all())
            .toEqual([]);
        expect(fixture.connections[1].closed).toBe(true);
        fixture.setIntercept();
        await repository.initDatabase();
        expect(await repository.getCategoriesDB()).toHaveLength(20);
        expect(await balances()).toEqual({ [cash]: 0 });
    });

    it('accepts a valid budget, rejects an invalid wallet FK and protects referenced parents', async () => {
        const budget = {
            id: 'valid', categoryId: 'cat-1', limitAmount: 100,
            startDate: date, endDate: '2026-11-30T23:59:59.000Z', walletId: cash,
        };
        await repository.insertBudgetDB(budget);
        await expect(repository.insertBudgetDB({ ...budget, id: 'invalid', walletId: 'missing' }))
            .rejects.toThrow(/FOREIGN KEY constraint failed/);
        expect(await repository.getBudgetsDB()).toHaveLength(1);
        await repository.insertWalletDB({
            id: 'referenced', name: 'Test wallet', icon: 'wallet', providerId: 'custom',
            openingBalance: 0, balance: 0, currency: 'ETB', isDefault: false, isArchived: false, createdAt: date,
        });
        await repository.insertBudgetDB({ ...budget, id: 'referenced-budget', walletId: 'referenced' });
        await expect(repository.deleteWalletDB('referenced')).rejects.toThrow(/FOREIGN KEY constraint failed/);
        expect((await balances()).referenced).toBe(0);
        expect(await repository.getBudgetsDB()).toHaveLength(2);
        expect(await (await repository.getDatabase()).getAllAsync('PRAGMA foreign_key_check;')).toEqual([]);
    });

    it('preserves insert/edit/status/wallet/type/delete balance effects and fractional birr', async () => {
        await repository.insertWalletDB({
            id: 'second', name: 'Test wallet', icon: 'wallet', providerId: 'custom',
            openingBalance: 0, balance: 0, currency: 'ETB', isDefault: false, isArchived: false, createdAt: date,
        });
        await repository.insertTransactionDB(transaction('expense', { amount: 25.75 }));
        expect(await balances()).toEqual({ [cash]: -25.75, second: 0 });
        await repository.updateTransactionDB('expense', { amount: 40.5 });
        expect(await balances()).toEqual({ [cash]: -40.5, second: 0 });
        await repository.updateTransactionDB('expense', { status: 'PENDING' });
        expect(await balances()).toEqual({ [cash]: 0, second: 0 });
        await repository.updateTransactionDB('expense', { status: 'CLEARED', walletId: 'second' });
        expect(await balances()).toEqual({ [cash]: 0, second: -40.5 });
        await repository.updateTransactionDB('expense', { type: 'CREDIT', categoryId: 'cat-16', amount: 60.25 });
        expect(await balances()).toEqual({ [cash]: 0, second: 60.25 });
        expect((await repository.getTransactionsDB())[0]).toMatchObject({
            amount: 60.25, type: 'CREDIT', walletId: 'second', status: 'CLEARED',
        });
        await repository.deleteTransactionDB('expense');
        await repository.deleteTransactionDB('expense');
        expect(await balances()).toEqual({ [cash]: 0, second: 0 });
        expect(await repository.getTransactionsDB()).toEqual([]);
    });

    it('rolls back an inserted row if its wallet update fails', async () => {
        await repository.initDatabase();
        fixture.setIntercept((event) => {
            if (event.sql.startsWith('UPDATE wallets SET balance =')) throw new Error('wallet update failed');
        });
        await expect(repository.insertTransactionDB(transaction('failed'))).rejects.toThrow('wallet update failed');
        fixture.setIntercept();
        expect(await repository.getTransactionsDB()).toEqual([]);
        expect(await balances()).toEqual({ [cash]: 0 });
        await repository.insertTransactionDB(transaction('next'));
        expect(await balances()).toEqual({ [cash]: -25 });
    });

    it('rolls back wallet adjustments if the transaction edit or delete fails', async () => {
        await repository.insertTransactionDB(transaction('original'));
        fixture.setIntercept((event) => {
            if (event.sql.startsWith('UPDATE transactions SET')) throw new Error('edit failed');
        });
        await expect(repository.updateTransactionDB('original', { amount: 50 })).rejects.toThrow('edit failed');
        fixture.setIntercept((event) => {
            if (event.sql.startsWith('DELETE FROM transactions')) throw new Error('delete failed');
        });
        await expect(repository.deleteTransactionDB('original')).rejects.toThrow('delete failed');
        fixture.setIntercept();
        expect(await balances()).toEqual({ [cash]: -25 });
        expect(await repository.getTransactionsDB()).toEqual([expect.objectContaining({ id: 'original', amount: 25 })]);
    });

    it('serializes concurrent writes without lost balances or partial failed operations', async () => {
        await repository.initDatabase();
        let writes = 0;
        fixture.setIntercept((event) => {
            if (event.sql.startsWith('UPDATE wallets SET balance =') && ++writes === 7) {
                throw new Error('one concurrent write failed');
            }
        });
        const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => (
            repository.insertTransactionDB(transaction(`concurrent-${index}`, index % 2 === 0
                ? { amount: 100, type: 'CREDIT', categoryId: 'cat-16' }
                : { amount: 10 }))
        )));
        fixture.setIntercept();
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(19);
        const transactions = await repository.getTransactionsDB();
        expect(transactions).toHaveLength(19);
        expect(transactions.some((tx) => tx.id === 'concurrent-6')).toBe(false);
        const net = transactions.reduce((sum, tx) => sum + (tx.type === 'CREDIT' ? tx.amount : -tx.amount), 0);
        expect(net).toBe(800);
        expect(await balances()).toEqual({ [cash]: net });
        await Promise.all(transactions.map((tx) => repository.deleteTransactionDB(tx.id)));
        expect(await balances()).toEqual({ [cash]: 0 });
        expect(await repository.getTransactionsDB()).toEqual([]);
    });

    it('serializes concurrent edits to the same transaction without applying stale balance effects', async () => {
        await repository.insertTransactionDB(transaction('edited'));
        await Promise.all([
            repository.updateTransactionDB('edited', { amount: 50 }),
            repository.updateTransactionDB('edited', { amount: 75 }),
            repository.updateTransactionDB('edited', { status: 'PENDING' }),
            repository.updateTransactionDB('edited', { status: 'CLEARED', amount: 100 }),
        ]);
        expect(await balances()).toEqual({ [cash]: -100 });
        expect((await repository.getTransactionsDB())[0]).toMatchObject({ amount: 100, status: 'CLEARED' });
    });

    it('keeps the existing valid JSON restore path compatible with enforced foreign keys', async () => {
        await repository.insertTransactionDB(transaction('retained'));
        await repository.insertBudgetDB({
            id: 'budget', categoryId: 'cat-1', limitAmount: 100,
            startDate: date, endDate: '2026-11-30T23:59:59.000Z', walletId: cash,
        });
        const backup = await repository.exportDatabaseToJSON();
        await repository.insertTransactionDB(transaction('later'));
        const result = await repository.importDatabaseFromJSON(backup);
        expect(result).toMatchObject({ restoredWallets: 1, restoredBudgets: 1, restoredTransactions: 1 });
        expect(await balances()).toEqual({ [cash]: -25 });
        expect((await repository.getTransactionsDB()).map((tx) => tx.id)).toEqual(['retained']);
        expect(await (await repository.getDatabase()).getAllAsync('PRAGMA foreign_key_check;')).toEqual([]);

        // Constraint failure after the restore's deletes must restore the prior data.
        await expect(repository.importDatabaseFromJSON({
            ...backup, transactions: [transaction('invalid', { amount: -1 })],
        })).rejects.toThrow(/CHECK constraint failed/);
        expect(await balances()).toEqual({ [cash]: -25 });
        expect((await repository.getTransactionsDB()).map((tx) => tx.id)).toEqual(['retained']);
        expect(await repository.getBudgetsDB()).toHaveLength(1);
    });
});
