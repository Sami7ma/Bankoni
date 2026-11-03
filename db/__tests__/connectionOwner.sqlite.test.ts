import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseConnectionOwner } from '../connectionOwner';
import { createSqliteFixture } from './sqliteFixture';

describe('Database connection owner (actual host SQLite, Expo bridge adapted)', () => {
    let fixture: ReturnType<typeof createSqliteFixture>;
    let owner: DatabaseConnectionOwner;

    beforeEach(() => {
        fixture = createSqliteFixture();
        owner = new DatabaseConnectionOwner(fixture.open);
    });
    afterEach(() => fixture.dispose());

    it('enforces foreign keys on the reader and every fresh writer before BEGIN', async () => {
        const reader = await owner.getReader();
        expect(await reader.getFirstAsync('PRAGMA foreign_keys;')).toEqual({ foreign_keys: 1 });
        await owner.withExclusiveTransaction(async (db) => {
            expect(await db.getFirstAsync('PRAGMA foreign_keys;')).toEqual({ foreign_keys: 1 });
            await db.execAsync(`
                CREATE TABLE parents (id INTEGER PRIMARY KEY);
                CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id));
                INSERT INTO parents VALUES (1);
                INSERT INTO children VALUES (1, 1);
            `);
        });
        await expect(owner.withExclusiveTransaction(async (db) => {
            await db.runAsync('INSERT INTO children VALUES (?, ?);', [2, 999]);
        })).rejects.toThrow(/FOREIGN KEY constraint failed/);
        await owner.withExclusiveTransaction(async (db) => {
            expect(await db.getFirstAsync('PRAGMA foreign_keys;')).toEqual({ foreign_keys: 1 });
            await db.runAsync('INSERT INTO children VALUES (?, ?);', [3, 1]);
        });
        expect(await reader.getAllAsync('SELECT id FROM children ORDER BY id;')).toEqual([{ id: 1 }, { id: 3 }]);
        expect(await reader.getAllAsync('PRAGMA foreign_key_check;')).toEqual([]);
        await expect(reader.getFirstAsync('INSERT INTO parents VALUES (2) RETURNING id;'))
            .rejects.toThrow(/readonly/);

        const begins = fixture.events.filter((event) => event.sql === 'BEGIN IMMEDIATE;');
        expect(begins).toHaveLength(3);
        for (const begin of begins) {
            expect(begin.connection).not.toBe(1);
            expect(begin.inTransaction).toBe(false);
            expect(begin.foreignKeys).toBe(1);
            const preceding = fixture.events.slice(0, fixture.events.indexOf(begin))
                .filter((event) => event.connection === begin.connection);
            expect(preceding.map((event) => event.sql)).toEqual([
                'PRAGMA foreign_keys = ON;', 'PRAGMA foreign_keys;',
            ]);
        }
        expect(fixture.connections.slice(1).every((connection) => connection.closed)).toBe(true);
    });

    it('rolls back every change on failure and permits a later independent write', async () => {
        await owner.withExclusiveTransaction(async (db) => {
            await db.execAsync('CREATE TABLE balances (id INTEGER PRIMARY KEY, balance INTEGER); INSERT INTO balances VALUES (1, 100);');
        });
        await expect(owner.withExclusiveTransaction(async (db) => {
            await db.execAsync('UPDATE balances SET balance = 20 WHERE id = 1; INSERT INTO balances VALUES (2, 80);');
            throw new Error('operation failed');
        })).rejects.toThrow('operation failed');
        const reader = await owner.getReader();
        expect(await reader.getAllAsync('SELECT * FROM balances;')).toEqual([{ id: 1, balance: 100 }]);
        await owner.withExclusiveTransaction(async (db) => {
            await db.execAsync('UPDATE balances SET balance = balance + 1 WHERE id = 1;');
        });
        expect(await reader.getFirstAsync('SELECT balance FROM balances;')).toEqual({ balance: 101 });
    });

    it('isolates reads, queues app writers and reserves the native writer lock', async () => {
        await owner.withExclusiveTransaction(async (db) => {
            await db.execAsync('CREATE TABLE balances (balance INTEGER); INSERT INTO balances VALUES (100);');
        });
        let release!: () => void;
        let entered!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const started = new Promise<void>((resolve) => { entered = resolve; });
        const first = owner.withExclusiveTransaction(async (db) => {
            await db.execAsync('UPDATE balances SET balance = balance - 10;');
            entered();
            await held;
        });
        await started;
        let secondEntered = false;
        const second = owner.withExclusiveTransaction(async (db) => {
            secondEntered = true;
            const row = await db.getFirstAsync<{ balance: number }>('SELECT balance FROM balances;');
            await db.runAsync('UPDATE balances SET balance = ?;', [row!.balance + 5]);
        });
        try {
            const reader = await owner.getReader();
            expect(await reader.getFirstAsync('SELECT balance FROM balances;')).toEqual({ balance: 100 });
            expect(secondEntered).toBe(false);
            const external = new DatabaseSync(fixture.path, { timeout: 0 });
            try {
                expect(() => external.exec('BEGIN IMMEDIATE;')).toThrow(/locked/);
            } finally {
                external.close();
            }
        } finally {
            release();
            await Promise.all([first, second]);
        }
        expect(secondEntered).toBe(true);
        expect(await (await owner.getReader()).getFirstAsync('SELECT balance FROM balances;'))
            .toEqual({ balance: 95 });
    });
});
