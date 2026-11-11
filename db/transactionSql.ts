import type { Transaction } from '../types/Transaction';

export interface SqlCommand { sql: string; params: (string | number | null)[] }

/** Shared by the repository and the iOS on-device JS runtime. Raw SMS stays in the recovery queue only. */
export function transactionInsert(tx: Transaction): SqlCommand {
    return {
        sql: `INSERT INTO transactions
        (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source,
         raw_sms, sms_reference, sms_fingerprint, is_transfer, transfer_wallet_id, sub_type,
         counterparty, merchant_id, education_institution_id, fee_amount, vat_amount, created_at,
         amount_minor, occurred_at, received_at, imported_at, date_source, date_precision, event_date, sms_details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        params: [tx.id, tx.amount, tx.type, tx.categoryId, tx.note || '', tx.date, tx.status,
            tx.walletId, tx.currentBalance ?? null, tx.source || 'manual', tx.smsReference ?? null,
            tx.smsFingerprint ?? null, tx.isTransfer ? 1 : 0, tx.transferWalletId ?? null,
            tx.subType || 'STANDARD', tx.counterparty ?? null, tx.merchantId ?? null,
            tx.educationInstitutionId ?? null, tx.feeAmount ?? null, tx.vatAmount ?? null, tx.createdAt,
            tx.amountMinor ?? Math.round(tx.amount * 100), tx.occurredAt ?? Date.parse(tx.date),
            tx.receivedAt ?? null, tx.importedAt ?? Date.parse(tx.createdAt), tx.dateSource ?? (tx.source === 'sms' ? 'legacy' : 'manual'), tx.datePrecision ?? null, tx.eventDate ?? null,tx.smsDetails ? JSON.stringify(tx.smsDetails):null],
    };
}
