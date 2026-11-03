// Additive inbox in the existing vault, not a second financial database.
export const COMPANION_INBOX_SCHEMA = `CREATE TABLE IF NOT EXISTS scriptable_sms_inbox (
 message_key TEXT PRIMARY KEY,
 body TEXT NOT NULL,
 sender TEXT NOT NULL,
 received_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','review','failed','imported','duplicate','dismissed')),
 reason TEXT NOT NULL DEFAULT '',
 batch_id TEXT NOT NULL,
 created_at TEXT NOT NULL
); CREATE INDEX IF NOT EXISTS scriptable_sms_inbox_status ON scriptable_sms_inbox(status);`;
export interface InboxRow { id: string; body: string; sender: string; receivedAt: number; status: 'pending'|'review'|'failed'|'imported'|'duplicate'|'dismissed'; reason: string }
