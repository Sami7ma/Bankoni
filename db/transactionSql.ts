import type { Transaction } from '../types/Transaction';

export interface SqlCommand { sql: string; params: (string | number | null)[] }

/** Shared by the repository and the iOS on-device JS runtime. Raw SMS stays in the recovery queue only. */
export function transactionInsert(tx: Transaction): SqlCommand {
    return {
        sql: `INSERT INTO transactions
        (id, amount, type, category_id, note, date, status, wallet_id, current_balance, source,
         raw_sms, sms_reference, sms_fingerprint, is_transfer, transfer_wallet_id, sub_type,
         counterparty, merchant_id, education_institution_id, fee_amount, vat_amount, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        params: [tx.id, tx.amount, tx.type, tx.categoryId, tx.note || '', tx.date, tx.status,
            tx.walletId, tx.currentBalance ?? null, tx.source || 'manual', tx.smsReference ?? null,
            tx.smsFingerprint ?? null, tx.isTransfer ? 1 : 0, tx.transferWalletId ?? null,
            tx.subType || 'STANDARD', tx.counterparty ?? null, tx.merchantId ?? null,
            tx.educationInstitutionId ?? null, tx.feeAmount ?? null, tx.vatAmount ?? null, tx.createdAt],
    };
}
