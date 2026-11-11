import {scriptableHost} from '../../platform/scriptable';
import * as repository from '../../db/database';
import { buildImportPlan, type ImportContext, type IncomingSms, type ImportPlan } from './plan';
import { generateSmsFingerprint, matchWalletForCandidate } from '../index';
import { nativeSms, smsStatus } from './native';
import { selectedSource, type FinancialSource } from '../sources';

export async function loadImportContext(): Promise<ImportContext> {
    const [wallets, categories, knownAccounts, merchants, merchantRules, educationInstitutions,existingTransactions] = await Promise.all([
        repository.getWalletsDB(), repository.getCategoriesDB(), repository.getKnownAccountsDB(),
        repository.getMerchantsDB(), repository.getMerchantRulesDB(), repository.getEducationInstitutionsDB(),
        repository.getTransactionsDB(),
    ]);
    return { wallets, categories, knownAccounts, merchants, merchantRules, educationInstitutions,existingTransactions };
}
let processing: Promise<void> | undefined;
let configuring = false;
export async function configureFinancialSources(sources: FinancialSource[]): Promise<void> {
    configuring = true;
    try { await processing; if(scriptableHost())await scriptableHost()!.request('sources.configure',{sources});else await nativeSms?.configureSources(JSON.stringify(sources)); }
    finally { configuring = false; }
}
export function drainSmsQueue(): Promise<void> {
    if (processing) return processing;
    processing = drain().finally(() => { processing = undefined; });
    return processing;
}
async function drain(): Promise<void> {
    // The experimental iOS intent owns its own native queue and has no Android source API.
    if (!nativeSms || typeof nativeSms.configureSources !== 'function' || configuring || !(await smsStatus()).enabled) return;
    await repository.initDatabase();
    // No auth state is loaded or changed by a background task. Only explicit SMS opt-in authorizes writes.
    const context = await loadImportContext();
    for (let batch = 0; batch < 4; batch++) {
        if (configuring || !(await smsStatus()).enabled) return;
        const messages: IncomingSms[] = JSON.parse(await nativeSms.pending(20));
        if (!messages.length) {
            const status = await smsStatus();
            if (status.scan.scanState !== 'running') await nativeSms.setPhase(status.scan.scanState === 'cancelled' ? 'cancelled' : (status.counts.failed ?? 0) > 0 ? 'failed' : 'completed');
            return;
        }
        const plans: { id: string; plan: ImportPlan }[] = [];
        for (const message of messages) {
            // Yield between messages so navigation and source revocation can run.
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            const status = await smsStatus();
            if (configuring || !status.enabled) return;
            if (message.source === 'history' && status.scan.scanState === 'cancelled') return;
            const source = selectedSource(message.sender, status.sources ?? [], undefined, message.source === 'live');
            if (!source || source.walletId !== message.walletId || source.providerId !== message.providerId) continue;
            if (!selectedSource(message.sender,status.sources ?? [],context.wallets, message.source === 'live')) {
                await nativeSms.finish(message.id,'review','The linked account is missing, archived, or belongs to another provider/currency. Reconfigure the source account and explicitly rescan.');
                continue;
            }
            try {
                await nativeSms.setPhase('parsing');
                const plan = buildImportPlan(message, { ...context, sources: status.sources ?? [] });
                // CBE duplicate decisions include verified ledger impact in the atomic
                // repository handoff; an old wrong amount must remain review evidence.
                if (plan.candidate && plan.candidate.providerId!=='cbe') {
                    const wallet = context.wallets.find(w => w.id === source.walletId);
                    if (wallet && (await repository.checkSmsDuplicateDB(plan.candidate.reference, generateSmsFingerprint(plan.candidate),wallet.id,plan.candidate.type)).isDuplicate) {
                        await nativeSms.finish(message.id, 'duplicate', 'Transaction is already in the ledger');
                        continue;
                    }
                }
                if (configuring) return;
                plans.push({ id:message.id,plan });
            } catch {
                // Do not persist exception text: parser/SQLite errors can contain private SMS or account data.
                await nativeSms.finish(message.id, 'failed', 'Processing interrupted. Automatic retry is scheduled; you can also retry here.');
            }
        }
        if (configuring) return;
        if (plans.length) {
            await nativeSms.setPhase('importing');
            try {
                const outcomes = await repository.applySmsProcessingBatchDB(plans);
                for (const outcome of outcomes) await nativeSms.finish(outcome.id,outcome.status,outcome.reason);
            } catch {
                // A failed durable commit acknowledges nothing as imported. Receipts also
                // make a process death after commit but before native acknowledgement safe.
                for (const item of plans) await nativeSms.finish(item.id,'failed','Storage interrupted. This batch will be retried safely.');
            }
        }
    }
    const status = await smsStatus();
    await nativeSms.setPhase(status.scan.scanState === 'running' ? 'scanning' : (status.counts.pending ?? 0) > 0 ? 'parsing' : (status.counts.failed ?? 0) > 0 ? 'failed' : 'completed');
}
