/** Additive v4 migration. Decimal columns remain compatible UI/backup boundaries. */
export const LEDGER_COLUMNS = {
    amount_minor: 'INTEGER', occurred_at: 'INTEGER', received_at: 'INTEGER', imported_at: 'INTEGER', date_source: 'TEXT', date_precision: 'TEXT', event_date: 'TEXT', sms_details: 'TEXT',
} as const;
const epoch = (column: string) => `CAST(ROUND((julianday(${column})-2440587.5)*86400000) AS INTEGER)`;
export const CBE_BALANCE_SCHEMA=`CREATE TABLE IF NOT EXISTS cbe_balance_checkpoints(
 id TEXT PRIMARY KEY,wallet_id TEXT NOT NULL REFERENCES wallets(id),account_last4 TEXT NOT NULL,
 balance_minor INTEGER NOT NULL CHECK(balance_minor>=0),observed_at INTEGER NOT NULL,received_at INTEGER NOT NULL,
 date_source TEXT NOT NULL,date_precision TEXT NOT NULL
);CREATE INDEX IF NOT EXISTS idx_cbe_balance_wallet ON cbe_balance_checkpoints(wallet_id,observed_at DESC);`;
// Include validated legacy ledger evidence when upgrading a wallet: an older
// new checkpoint must never hide a newer balance already present in its ledger.
export const cbeBalanceEvidence = (wallet='wallets.id') => `
 SELECT c.id,c.balance_minor,c.observed_at,c.received_at,c.date_source,c.date_precision
 FROM cbe_balance_checkpoints c WHERE c.wallet_id=${wallet}
 AND c.account_last4=(SELECT w.account_number_last4 FROM wallets w WHERE w.id=${wallet})
 UNION ALL
 SELECT b.id,CAST(ROUND(b.current_balance*100) AS INTEGER),COALESCE(b.occurred_at,${epoch('b.date')}),b.received_at,b.date_source,b.date_precision
 FROM transactions b WHERE b.wallet_id=${wallet} AND b.status='CLEARED' AND b.source='sms'
 AND COALESCE(b.sub_type,'')<>'FEE' AND b.current_balance>=0 AND CASE WHEN json_valid(b.sms_details)
 THEN json_extract(b.sms_details,'$.provider')='cbe'
 AND json_extract(b.sms_details,'$.accountLast4')=(SELECT w.account_number_last4 FROM wallets w WHERE w.id=${wallet})
 AND json_extract(b.sms_details,'$.principalMinor')=b.amount_minor
 AND json_extract(b.sms_details,'$.direction')=b.type ELSE 0 END`;
// A bank checkpoint is an account balance, never income. Later ledger movements
// are applied once; principal and fees belonging to the checkpoint are already included.
export const ledgerBalance = (wallet = 'wallets.id', opening = 'opening_balance') => {
 const signed=(alias:string)=>`CASE WHEN ${alias}.type='CREDIT' THEN COALESCE(${alias}.amount_minor,CAST(ROUND(${alias}.amount*100) AS INTEGER)) ELSE -COALESCE(${alias}.amount_minor,CAST(ROUND(${alias}.amount*100) AS INTEGER)) END`;
 const event=(alias:string)=>`COALESCE(${alias}.occurred_at,${epoch(alias+'.date')})`;
 const evidence=cbeBalanceEvidence(wallet);
 const bankCheckpoint=`(SELECT e.balance_minor+COALESCE((SELECT SUM(${signed('t')}) FROM transactions t WHERE t.wallet_id=${wallet} AND t.status='CLEARED' AND ${event('t')}>e.observed_at),0) FROM (SELECT * FROM (${evidence}) ORDER BY observed_at DESC,received_at DESC,id DESC LIMIT 1) e)`;
 const net=`CAST(ROUND(${opening}*100) AS INTEGER)+COALESCE((SELECT SUM(${signed('t')}) FROM transactions t WHERE t.wallet_id=${wallet} AND t.status='CLEARED'),0)`;
 return `(CASE WHEN (SELECT w_mode.balance_mode='cbe_sms' AND w_mode.provider_id='cbe' AND w_mode.currency='ETB' FROM wallets w_mode WHERE w_mode.id=${wallet}) THEN COALESCE(${bankCheckpoint},${net}) ELSE ${net} END)/100.0`;
};
export const LEDGER_INTEGRITY_SQL = `
DROP TRIGGER IF EXISTS ledger_cbe_balance_insert;
DROP TRIGGER IF EXISTS ledger_cbe_balance_delete;
DROP TRIGGER IF EXISTS ledger_amount_insert;
DROP TRIGGER IF EXISTS ledger_amount_update;
DROP TRIGGER IF EXISTS ledger_minor_update;
DROP TRIGGER IF EXISTS ledger_metadata_insert;
DROP TRIGGER IF EXISTS ledger_metadata_update;
DROP TRIGGER IF EXISTS ledger_delete;
DROP TRIGGER IF EXISTS ledger_wallet_insert;
DROP TRIGGER IF EXISTS ledger_opening_update;
DROP TRIGGER IF EXISTS ledger_balance_guard;

UPDATE transactions SET amount_minor=CAST(ROUND(amount*100) AS INTEGER),
 occurred_at=${epoch('date')}, imported_at=${epoch('created_at')}, date_source='legacy'
 WHERE amount_minor IS NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_event_wallet ON transactions(status,occurred_at,wallet_id);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet_status ON transactions(wallet_id,status,occurred_at);
CREATE INDEX IF NOT EXISTS idx_ledger_event_order ON transactions(occurred_at DESC,imported_at DESC,id DESC);
CREATE TRIGGER IF NOT EXISTS ledger_amount_insert BEFORE INSERT ON transactions
 WHEN NEW.amount>90071992547409.91 OR ABS(NEW.amount*100-ROUND(NEW.amount*100))>0.00001 OR (NEW.amount_minor IS NOT NULL AND (NEW.amount_minor<>CAST(ROUND(NEW.amount*100) AS INTEGER) OR NEW.amount_minor<=0 OR NEW.amount_minor>9007199254740991))
 BEGIN SELECT RAISE(ABORT,'Invalid integer monetary amount'); END;
CREATE TRIGGER IF NOT EXISTS ledger_amount_update BEFORE UPDATE OF amount ON transactions
 WHEN NEW.amount<=0 OR NEW.amount>90071992547409.91 OR ABS(NEW.amount*100-ROUND(NEW.amount*100))>0.00001
 BEGIN SELECT RAISE(ABORT,'Invalid integer monetary amount'); END;
CREATE TRIGGER IF NOT EXISTS ledger_minor_update BEFORE UPDATE OF amount_minor ON transactions
 WHEN NEW.amount_minor IS NOT NULL AND NEW.amount_minor<>CAST(ROUND(NEW.amount*100) AS INTEGER)
 BEGIN SELECT RAISE(ABORT,'Invalid integer monetary amount'); END;
CREATE TRIGGER IF NOT EXISTS ledger_metadata_insert AFTER INSERT ON transactions BEGIN
 UPDATE transactions SET amount_minor=CAST(ROUND(amount*100) AS INTEGER),
 occurred_at=COALESCE(occurred_at,${epoch('date')}), imported_at=COALESCE(imported_at,${epoch('created_at')}),
 date_source=COALESCE(date_source,CASE WHEN source='sms' THEN 'legacy' ELSE 'manual' END) WHERE id=NEW.id;
 UPDATE wallets SET balance=${ledgerBalance()} WHERE id=NEW.wallet_id;
END;
CREATE TRIGGER IF NOT EXISTS ledger_metadata_update AFTER UPDATE OF amount,date,status,type,wallet_id ON transactions BEGIN
 UPDATE transactions SET amount_minor=CAST(ROUND(amount*100) AS INTEGER), occurred_at=${epoch('date')} WHERE id=NEW.id;
 UPDATE wallets SET balance=${ledgerBalance()} WHERE id IN (NEW.wallet_id,OLD.wallet_id);
END;
CREATE TRIGGER IF NOT EXISTS ledger_delete AFTER DELETE ON transactions BEGIN
 UPDATE wallets SET balance=${ledgerBalance()} WHERE id=OLD.wallet_id;
END;
CREATE TRIGGER IF NOT EXISTS ledger_wallet_insert AFTER INSERT ON wallets BEGIN
 UPDATE wallets SET balance=${ledgerBalance()} WHERE id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS ledger_opening_update AFTER UPDATE OF opening_balance,balance_mode,account_number_last4,provider_id,currency ON wallets BEGIN
 UPDATE wallets SET balance=${ledgerBalance()} WHERE id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS ledger_balance_guard AFTER UPDATE OF balance ON wallets
 WHEN NEW.balance<>${ledgerBalance('NEW.id','NEW.opening_balance')}
 BEGIN UPDATE wallets SET balance=${ledgerBalance()} WHERE id=NEW.id; END;
CREATE TRIGGER ledger_cbe_balance_insert AFTER INSERT ON cbe_balance_checkpoints BEGIN UPDATE wallets SET balance=${ledgerBalance()} WHERE id=NEW.wallet_id; END;
CREATE TRIGGER ledger_cbe_balance_delete AFTER DELETE ON cbe_balance_checkpoints BEGIN UPDATE wallets SET balance=${ledgerBalance()} WHERE id=OLD.wallet_id; END;
UPDATE wallets SET balance=${ledgerBalance()};
`;
