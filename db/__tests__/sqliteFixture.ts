/// <reference types="node" />
// Host SQLite integration adapter, not an Expo native-device test.
// Each open() is a real connection to a disposable file, with foreign keys OFF
// initially so Node's defaults cannot hide missing application initialization.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQLiteDatabase } from 'expo-sqlite';

export interface SqlEvent {
    connection: number;
    sql: string;
    inTransaction: boolean;
    foreignKeys: number;
}

export function createSqliteFixture() {
    const directory = mkdtempSync(join(tmpdir(), 'bankoni-connection-test-'));
    const path = join(directory, 'fixture.db');
    const connections: Array<{ native: DatabaseSync; closed: boolean }> = [];
    const events: SqlEvent[] = [];
    let intercept: ((event: SqlEvent) => void | Promise<void>) | undefined;

    async function open(): Promise<SQLiteDatabase> {
        const native = new DatabaseSync(path);
        native.exec('PRAGMA foreign_keys = OFF;');
        const record = { native, closed: false };
        const connection = connections.push(record);
        const before = async (sql: string) => {
            const event = {
                connection,
                sql,
                inTransaction: native.isTransaction,
                foreignKeys: Number(native.prepare('PRAGMA foreign_keys;').get()!.foreign_keys),
            };
            events.push(event);
            await intercept?.(event);
        };
        const bind = (args: unknown[]): SQLInputValue[] => (
            args.length === 1 && Array.isArray(args[0]) ? args[0] : args
        ) as SQLInputValue[];

        // Only the Expo methods used by the repository/owner are adapted. SQL,
        // constraints, transactions, locking and rollback run in actual SQLite.
        return {
            async isInTransactionAsync() { return native.isTransaction; },
            async execAsync(sql: string) {
                await before(sql);
                native.exec(sql);
            },
            async runAsync(sql: string, ...args: unknown[]) {
                await before(sql);
                const result = native.prepare(sql).run(...bind(args));
                return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
            },
            async getFirstAsync(sql: string, ...args: unknown[]) {
                await before(sql);
                return native.prepare(sql).get(...bind(args)) ?? null;
            },
            async getAllAsync(sql: string, ...args: unknown[]) {
                await before(sql);
                return native.prepare(sql).all(...bind(args));
            },
            async closeAsync() {
                native.close();
                record.closed = true;
            },
        } as unknown as SQLiteDatabase;
    }

    return {
        open,
        events,
        connections,
        path,
        setIntercept(callback?: typeof intercept) { intercept = callback; },
        dispose() {
            for (const record of connections) {
                if (!record.closed) record.native.close();
                record.closed = true;
            }
            rmSync(directory, { recursive: true, force: true });
        },
    };
}
