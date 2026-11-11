import type { SmsProviderId } from './types';
import type { Wallet } from '../types/Wallet';

/** Aliases are explicit addresses, never substrings or guesses from message contents. */
export interface FinancialSource {
    id: string;
    providerId: SmsProviderId;
    name: string;
    senderIds: string[];
    selected: boolean;
    automatic: boolean;
    walletId: string | null;
}
export const SOURCE_CATALOG: FinancialSource[] = [
    ['cbe', 'Commercial Bank of Ethiopia', ['CBE']],
    ['cbe_birr', 'CBE Birr', ['CBE Birr', 'CBE-Birr', 'CBEBirr']],
    ['telebirr', 'Telebirr', ['telebirr']],
    ['dashen', 'Dashen Bank', ['Dashen', 'DashenBank']],
    ['boa', 'Bank of Abyssinia', ['BOA', 'Abyssinia']],
    ['awash', 'Awash Bank', ['Awash', 'AwashBank']],
    ['mpesa', 'M-PESA', ['M-PESA', 'MPESA']],
].map(([id, name, senderIds]) => ({ id: id as string, providerId: id as SmsProviderId,
    name: name as string, senderIds: senderIds as string[], selected: false, automatic: false, walletId: null }));

// Keep identical to SenderRegistry.normalize on Android. Do not strip arbitrary punctuation.
export function normalizeSender(sender: string): string { return sender.trim().toUpperCase(); }
export function selectedSource(sender: string, sources: FinancialSource[], wallets?: Wallet[], requireAutomatic = true): FinancialSource | undefined {
    if (!Array.isArray(sources) || typeof sender !== 'string') return undefined;
    const matches = sources.filter(s => s.selected && (!requireAutomatic || s.automatic) && s.walletId
        && s.senderIds.some(id => normalizeSender(id) === normalizeSender(sender)));
    if (matches.length !== 1) return undefined;
    const source = matches[0];
    if (wallets && !wallets.some(w => w.id === source.walletId && !w.isArchived && w.currency === 'ETB' && w.providerId === source.providerId)) return undefined;
    return source;
}

/** Merge one wallet's explicit consent without changing any other wallet's configuration. */
export function authorizeWalletSource(sources: FinancialSource[], wallet: Wallet, aliases: string[], automatic: boolean): FinancialSource[] {
    const provider = SOURCE_CATALOG.find(s => s.providerId === wallet.providerId);
    if (!provider || wallet.isArchived || wallet.currency !== 'ETB') throw Error('Choose an active supported ETB account.');
    const senderIds = [...new Set(aliases.map(normalizeSender))];
    if(wallet.providerId==='cbe' && senderIds.some(id=>SOURCE_CATALOG.filter(s=>s.providerId!=='cbe').some(s=>s.senderIds.some(other=>normalizeSender(other)===id))))throw Error('CBE bank import cannot authorize CBE Birr or another provider sender.');
    if (!senderIds.length || senderIds.length > 20 || senderIds.some(id => !id || id.length > 64 || /[\x00-\x1f\x7f]/.test(id))) throw Error('Enter 1–20 exact sender IDs, up to 64 characters each.');
    if (sources.some(s => s.selected && s.walletId !== wallet.id && s.senderIds.some(id => senderIds.includes(normalizeSender(id))))) throw Error('This sender is already authorized for another account. Change that mapping explicitly first.');
    const current = sources.find(s => s.walletId === wallet.id && s.providerId === wallet.providerId);
    const next: FinancialSource = { ...provider, id: current?.id ?? `wallet:${wallet.id}`, senderIds, walletId: wallet.id, selected: true, automatic };
    return [...sources.filter(s => s.id !== next.id), next];
}
export function rollingImportWindow(now = Date.now()): { start: number; end: number } {
    const start = new Date(now), day = start.getDate();
    start.setDate(1); start.setFullYear(start.getFullYear() - 1);
    start.setDate(Math.min(day, new Date(start.getFullYear(), start.getMonth()+1, 0).getDate()));
    return { start: start.getTime(), end: now };
}

export type ImportPeriod = '3m'|'6m'|'1y'|'all'|'custom';
/** Gregorian Ethiopia-local day boundaries; months clamp to their actual last day. */
export function accountImportWindow(period:ImportPeriod, now=Date.now(), customDate?:string):{start:number;end:number} {
    if(!Number.isSafeInteger(now))throw Error('Invalid import end time.');
    let start:number;
    if(period==='all')start=Date.UTC(2000,0,1);
    else if(period==='custom') {
        const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(customDate??'');
        if(!m || +m[1]<2000 || +m[2]<1 || +m[2]>12 || +m[3]<1 || +m[3]>new Date(Date.UTC(+m[1],+m[2],0)).getUTCDate())throw Error('Choose a valid Gregorian start date (YYYY-MM-DD).');
        start=Date.UTC(+m[1],+m[2]-1,+m[3])-10800000;
    } else {
        const d=new Date(now+10800000),day=d.getUTCDate();
        d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-(period==='3m'?3:period==='6m'?6:12));
        d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));
        start=d.getTime()-10800000;
    }
    if(start>now)throw Error('The start date must be on or before today.');
    return {start,end:now};
}
