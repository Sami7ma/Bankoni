import * as repository from '../../db/database';
import { buildImportPlan, type ImportContext, type IncomingSms } from './plan';
import { generateSmsFingerprint, matchWalletForCandidate } from '../index';
import { nativeSms, smsStatus } from './native';

export async function loadImportContext(): Promise<ImportContext> {
    const [wallets, categories, knownAccounts, merchants, merchantRules, educationInstitutions] = await Promise.all([
        repository.getWalletsDB(), repository.getCategoriesDB(), repository.getKnownAccountsDB(),
        repository.getMerchantsDB(), repository.getMerchantRulesDB(), repository.getEducationInstitutionsDB(),
    ]);
    return { wallets, categories, knownAccounts, merchants, merchantRules, educationInstitutions };
}
let processing: Promise<void> | undefined;
export function drainSmsQueue(): Promise<void> {
    if (processing) return processing;
    processing = drain().finally(() => { processing = undefined; });
    return processing;
}
async function drain(): Promise<void> {
    if (!nativeSms || !(await smsStatus()).enabled) return;
    await repository.initDatabase();
    // No auth state is loaded or changed by a background task. Only explicit SMS opt-in authorizes writes.
    const context = await loadImportContext();
    for (let batch = 0; batch < 4; batch++) {
        if (!(await smsStatus()).enabled) return;
        const messages: IncomingSms[] = JSON.parse(await nativeSms.pending(40));
        if (!messages.length) return;
        for (const message of messages) {
            if (!(await smsStatus()).enabled) return;
            try {
                if (await repository.hasSmsImportReceiptDB(message.id)) {
                    await nativeSms.finish(message.id, 'duplicate', 'Transaction is already in the ledger');
                    continue;
                }
                const plan = buildImportPlan(message, context);
                if (plan.candidate) {
                    const wallet = matchWalletForCandidate(plan.candidate, context.wallets).matchedWallet;
                    if (wallet && (await repository.checkSmsDuplicateDB(plan.candidate.reference, generateSmsFingerprint(plan.candidate),wallet.id,plan.candidate.type)).isDuplicate) {
                        await nativeSms.finish(message.id, 'duplicate', 'Transaction is already in the ledger');
                        continue;
                    }
                }
                const status = plan.status === 'imported'
                    ? await repository.applySmsImportPlanDB(message.id, plan) : plan.status;
                await nativeSms.finish(message.id, status, plan.reason);
            } catch {
                // Do not persist exception text: parser/SQLite errors can contain private SMS or account data.
                await nativeSms.finish(message.id, 'failed', 'Processing interrupted. Automatic retry is scheduled; you can also retry here.');
            }
        }
    }
}
