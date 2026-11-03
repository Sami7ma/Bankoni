// Main-app handoff. No native SMS permission/module is required for file import.
import * as repository from '../../db/database';
import { buildImportPlan, readEnvelope } from './core';
import { loadImportContext } from '../automatic/processor';
import type { ImportContext } from '../automatic/plan';
import type { InboxRow } from './schema';

export interface CompanionImportResult { imported: number; duplicate: number; review: number; failed: number; skipped: number; invalid: {index:number;reason:string}[] }
let running: Promise<CompanionImportResult> | undefined;
async function currentContext(): Promise<ImportContext> {
    const context=await loadImportContext();
    return {...context,wallets:context.wallets.filter(wallet=>wallet.currency==='ETB')};
}
async function processRows(rows: InboxRow[], context: ImportContext): Promise<CompanionImportResult> {
    const result: CompanionImportResult = { imported:0,duplicate:0,review:0,failed:0,skipped:0,invalid:[] };
    for (const row of rows) {
        try {
            if (await repository.hasSmsImportReceiptDB(row.id)) {
                await repository.finishScriptableMessageDB(row.id,'duplicate','Already in the ledger'); result.duplicate++; continue;
            }
            const plan = buildImportPlan({...row,source:'scriptable'},context);
            if (plan.status === 'skipped') {
                await repository.finishScriptableMessageDB(row.id,'dismissed',plan.reason);result.skipped++;continue;
            }
            const status = plan.status === 'imported' ? await repository.applySmsImportPlanDB(row.id,plan) : 'review';
            await repository.finishScriptableMessageDB(row.id,status,plan.reason);result[status]++;
        } catch {
            // A failed status write may itself fail. The row stays pending; receipts protect retry.
            try { await repository.finishScriptableMessageDB(row.id,'failed','Local processing failed. Retry when storage is available.'); } catch { /* durable pending row remains */ }
            result.failed++;
        }
    }
    return result;
}
export async function importCompanionFile(raw: string): Promise<CompanionImportResult> {
    if (running) throw Error('Another companion import is running. Wait for it to finish.');
    const parsed = readEnvelope(raw);
    const operation = (async () => {
        await repository.stageScriptableMessagesDB(parsed.records,parsed.envelope.batchId);
        const context = await currentContext();
        // Include terminal rows as duplicates in repeat-import reporting without resurrecting them.
        const active = new Map((await repository.getScriptableMessagesDB(parsed.records.map(row=>row.id))).filter(row=>['pending','review','failed'].includes(row.status)).map(row=>[row.id,row]));
        const result = await processRows(parsed.records.filter(row=>active.has(row.id)).map(row=>active.get(row.id)!),context);
        const inactive = parsed.records.filter(row=>!active.has(row.id));
        for (const row of inactive) { if (await repository.hasSmsImportReceiptDB(row.id)) result.duplicate++; else result.skipped++; }
        result.skipped += parsed.skipped; result.invalid = parsed.errors;
        return result;
    })();
    running = operation;
    try { return await operation; } finally { running=undefined; }
}
export async function retryCompanionInbox(ids?: string[]): Promise<CompanionImportResult> {
    if (running) throw Error('Another companion import is running');
    const operation = (async()=>processRows(ids ? (await repository.getScriptableMessagesDB(ids)).filter(row=>['pending','review','failed'].includes(row.status)) : await repository.getScriptableInboxDB(200),await currentContext()))();
    running=operation;
    try { return await operation; } finally { running=undefined; }
}
export async function exportCompanionContext(): Promise<string> {
    const context = await loadImportContext();
    return JSON.stringify({format:'bankoni.scriptable.context',version:1,
        wallets:context.wallets.filter(w=>!w.isArchived && w.currency==='ETB').map(w=>({id:w.id,name:w.name,providerId:w.providerId,accountNumberLast4:w.accountNumberLast4,currency:w.currency,isArchived:false,icon:w.icon})),
        categories:context.categories,
        knownAccounts:context.knownAccounts.map(a=>({id:a.id,walletId:a.walletId,providerId:a.providerId,accountLast4:a.accountLast4,ownership:a.ownership})),
    },null,2);
}
