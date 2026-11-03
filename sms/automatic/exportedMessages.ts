import { isFinancialMessage } from './plan';
export interface ExportedMessage { body: string; sender: string; receivedAt: number }
/** Explicitly user-selected JSON export, not direct iOS inbox access. */
export function readExportedMessages(raw: string, now = Date.now()): ExportedMessage[] {
    if (raw.length > 5 * 1024 * 1024) throw new Error('Choose a JSON export smaller than 5 MB');
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Expected an array of at most 10,000 messages');
    const start = new Date(now); start.setMonth(start.getMonth() - 12);
    return rows.flatMap(row => {
        if (!row || typeof row.body !== 'string' || typeof row.sender !== 'string') return [];
        const receivedAt = typeof row.receivedAt === 'number' ? row.receivedAt : Date.parse(row.receivedAt);
        if (!Number.isFinite(receivedAt) || receivedAt < start.getTime() || receivedAt > now || !isFinancialMessage(row.body,row.sender)) return [];
        return [{ body: row.body, sender: row.sender.slice(0,128), receivedAt }];
    });
}
