import { describe, expect, it, jest } from '@jest/globals';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseConnectionOwner } from '../connectionOwner';

function fakeConnection(setting: number | null = 1) {
    const calls: string[] = [];
    const db = {
        isInTransactionAsync: jest.fn(async () => false),
        execAsync: jest.fn(async (sql: string) => { calls.push(sql); }),
        getFirstAsync: jest.fn(async (sql: string) => {
            calls.push(sql);
            return setting == null ? null : { foreign_keys: setting };
        }),
        closeAsync: jest.fn(async () => {}),
    };
    return { db, calls, connection: db as unknown as SQLiteDatabase };
}

describe('Database connection owner (mocked lifecycle/failure tests)', () => {
    it('configures and verifies both connections before BEGIN and closes the writer', async () => {
        const reader = fakeConnection();
        const writer = fakeConnection();
        const open = jest.fn<() => Promise<SQLiteDatabase>>()
            .mockResolvedValueOnce(reader.connection).mockResolvedValueOnce(writer.connection);
        const owner = new DatabaseConnectionOwner(open);

        await expect(owner.withExclusiveTransaction(async () => 'saved')).resolves.toBe('saved');
        expect(writer.calls).toEqual([
            'PRAGMA foreign_keys = ON;', 'PRAGMA foreign_keys;', 'BEGIN IMMEDIATE;', 'COMMIT;',
        ]);
        expect(reader.calls).toEqual([
            'PRAGMA foreign_keys = ON;', 'PRAGMA foreign_keys;',
            'PRAGMA journal_mode = WAL;', 'PRAGMA query_only = ON;',
        ]);
        expect(writer.db.closeAsync).toHaveBeenCalledTimes(1);
        expect(reader.db.closeAsync).not.toHaveBeenCalled();
    });

    it.each([0, null])('fails closed when foreign_keys reads back as %s', async (setting) => {
        const reader = fakeConnection();
        const writer = fakeConnection(setting);
        const open = jest.fn<() => Promise<SQLiteDatabase>>()
            .mockResolvedValueOnce(reader.connection).mockResolvedValueOnce(writer.connection);
        const work = jest.fn(async () => {});
        await expect(new DatabaseConnectionOwner(open).withExclusiveTransaction(work))
            .rejects.toThrow('foreign-key enforcement');
        expect(work).not.toHaveBeenCalled();
        expect(writer.calls).not.toContain('BEGIN IMMEDIATE;');
        expect(writer.db.closeAsync).toHaveBeenCalledTimes(1);
    });

    it('closes and retries a reader when foreign-key verification fails', async () => {
        const failed = fakeConnection(0);
        const good = fakeConnection();
        const open = jest.fn<() => Promise<SQLiteDatabase>>()
            .mockResolvedValueOnce(failed.connection).mockResolvedValueOnce(good.connection);
        const owner = new DatabaseConnectionOwner(open);
        await expect(owner.getReader()).rejects.toThrow('foreign-key enforcement');
        expect(failed.calls).not.toContain('PRAGMA journal_mode = WAL;');
        expect(failed.db.closeAsync).toHaveBeenCalledTimes(1);
        await expect(owner.getReader()).resolves.toBe(good.connection);
    });

    it('refuses an already-active connection before attempting to configure it', async () => {
        const reader = fakeConnection();
        reader.db.isInTransactionAsync.mockResolvedValue(true);
        const owner = new DatabaseConnectionOwner(async () => reader.connection);
        await expect(owner.getReader()).rejects.toThrow('inside a transaction');
        expect(reader.calls).toEqual([]);
        expect(reader.db.closeAsync).toHaveBeenCalledTimes(1);
    });

    it('shares reader initialization and retries an open failure', async () => {
        const reader = fakeConnection();
        const open = jest.fn<() => Promise<SQLiteDatabase>>()
            .mockRejectedValueOnce(new Error('open failed')).mockResolvedValue(reader.connection);
        const owner = new DatabaseConnectionOwner(open);
        await expect(owner.getReader()).rejects.toThrow('open failed');
        const [first, second] = await Promise.all([owner.getReader(), owner.getReader()]);
        expect(first).toBe(second);
        expect(open).toHaveBeenCalledTimes(2);
    });

    it('closes and retries a reader whose WAL setup fails', async () => {
        const failed = fakeConnection();
        failed.db.execAsync.mockImplementation(async (sql) => {
            if (sql.includes('journal_mode')) throw new Error('WAL setup failed');
        });
        const good = fakeConnection();
        const open = jest.fn<() => Promise<SQLiteDatabase>>()
            .mockResolvedValueOnce(failed.connection).mockResolvedValueOnce(good.connection);
        const owner = new DatabaseConnectionOwner(open);
        await expect(owner.getReader()).rejects.toThrow('WAL setup failed');
        await expect(owner.getReader()).resolves.toBe(good.connection);
        expect(failed.db.closeAsync).toHaveBeenCalledTimes(1);
    });

    it('rolls back a commit failure and allows the next queued operation', async () => {
        const reader = fakeConnection();
        const failed = fakeConnection();
        failed.db.execAsync.mockImplementation(async (sql) => {
            failed.calls.push(sql);
            if (sql === 'COMMIT;') throw new Error('commit failed');
        });
        const good = fakeConnection();
        const open = jest.fn<() => Promise<SQLiteDatabase>>()
            .mockResolvedValueOnce(reader.connection)
            .mockResolvedValueOnce(failed.connection).mockResolvedValueOnce(good.connection);
        const owner = new DatabaseConnectionOwner(open);
        const first = owner.withExclusiveTransaction(async () => {});
        const second = owner.withExclusiveTransaction(async () => 'next');
        await expect(first).rejects.toThrow('commit failed');
        await expect(second).resolves.toBe('next');
        expect(failed.calls).toContain('ROLLBACK;');
        expect(failed.db.closeAsync).toHaveBeenCalledTimes(1);
    });

    it('preserves the callback error if rollback and close also fail', async () => {
        const reader = fakeConnection();
        const writer = fakeConnection();
        writer.db.execAsync.mockImplementation(async (sql) => {
            if (sql === 'ROLLBACK;') throw new Error('rollback failed');
        });
        writer.db.closeAsync.mockRejectedValue(new Error('close failed'));
        const open = jest.fn<() => Promise<SQLiteDatabase>>()
            .mockResolvedValueOnce(reader.connection).mockResolvedValueOnce(writer.connection);
        await expect(new DatabaseConnectionOwner(open).withExclusiveTransaction(async () => {
            throw new Error('original failure');
        })).rejects.toThrow('original failure');
    });

    it('does not run the callback or issue rollback when BEGIN fails', async () => {
        const reader = fakeConnection();
        const writer = fakeConnection();
        writer.db.execAsync.mockImplementation(async (sql) => {
            writer.calls.push(sql);
            if (sql === 'BEGIN IMMEDIATE;') throw new Error('database is locked');
        });
        const open = jest.fn<() => Promise<SQLiteDatabase>>()
            .mockResolvedValueOnce(reader.connection).mockResolvedValueOnce(writer.connection);
        const work = jest.fn(async () => {});
        await expect(new DatabaseConnectionOwner(open).withExclusiveTransaction(work))
            .rejects.toThrow('database is locked');
        expect(work).not.toHaveBeenCalled();
        expect(writer.calls).not.toContain('ROLLBACK;');
        expect(writer.db.closeAsync).toHaveBeenCalledTimes(1);
    });
});
