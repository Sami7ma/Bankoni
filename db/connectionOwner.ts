import type { SQLiteDatabase } from 'expo-sqlite';

export type DatabaseReader = Pick<SQLiteDatabase, 'getFirstAsync' | 'getAllAsync'>;

/**
 * Owns a read connection and serializes work on dedicated write connections.
 * Expo's exclusive helper starts BEGIN before its callback, too late to enable
 * foreign keys there. Open/configure our own connection before starting BEGIN.
 */
export class DatabaseConnectionOwner {
    private readerPromise: Promise<SQLiteDatabase> | null = null;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(private readonly openConnection: () => Promise<SQLiteDatabase>) {}

    private async openConfiguredConnection(): Promise<SQLiteDatabase> {
        const db = await this.openConnection();
        try {
            if (await db.isInTransactionAsync()) {
                throw new Error('Cannot configure a database connection inside a transaction.');
            }
            await db.execAsync('PRAGMA foreign_keys = ON;');
            const setting = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys;');
            if (setting?.foreign_keys !== 1) {
                throw new Error('SQLite foreign-key enforcement could not be enabled.');
            }
            return db;
        } catch (error) {
            try { await db.closeAsync(); } catch { /* Preserve the configuration failure. */ }
            throw error;
        }
    }

    getReader(): Promise<DatabaseReader> {
        if (!this.readerPromise) {
            this.readerPromise = this.openConfiguredConnection().then(async (db) => {
                try {
                    // WAL is persistent for this database file. Set it before opening writers.
                    await db.execAsync('PRAGMA journal_mode = WAL;');
                    // Guard against accidental writes through a query method on the reader.
                    await db.execAsync('PRAGMA query_only = ON;');
                    return db;
                } catch (error) {
                    try { await db.closeAsync(); } catch { /* Preserve the setup failure. */ }
                    throw error;
                }
            }).catch((error) => {
                this.readerPromise = null;
                throw error;
            });
        }
        return this.readerPromise;
    }

    withExclusiveTransaction<T>(work: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
        const operation = this.writeQueue.then(async () => {
            await this.getReader();
            const db = await this.openConfiguredConnection();
            let transactionStarted = false;
            let operationFailed = false;
            try {
                // Reserve SQLite's single writer before the callback can read/modify data.
                // Other app writes wait in writeQueue; unrelated connections cannot join us.
                await db.execAsync('BEGIN IMMEDIATE;');
                transactionStarted = true;
                const result = await work(db);
                await db.execAsync('COMMIT;');
                transactionStarted = false;
                return result;
            } catch (error) {
                operationFailed = true;
                if (transactionStarted) {
                    try { await db.execAsync('ROLLBACK;'); } catch { /* SQLite may have already rolled back. */ }
                }
                throw error;
            } finally {
                try { await db.closeAsync(); } catch (error) {
                    if (!operationFailed) throw error;
                }
            }
        });
        // A rejected write must not prevent later independent operations from running.
        this.writeQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }
}
