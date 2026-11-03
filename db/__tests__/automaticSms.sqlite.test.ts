import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isEarnedIncome, isPersonalSpending } from '../../utils/financial';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { createSqliteFixture } from './sqliteFixture';
import { buildImportPlan, type ImportContext, type IncomingSms } from '../../sms/automatic/plan';
import { defaultCategories } from '../../constants/defaultCategories';
import type { Wallet } from '../../types/Wallet';

const date = '2026-11-01T05:38:24.000Z';
const cbe = 'Dear Samuel Mifta Awol A debit transaction of ETB 370.0. has occurred on your account 1********2293. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB382.00. Your current balance is ETB367,670.94.';
const telebirr = 'Dear SAMUEL, You have received ETB 370.00 by transaction number DK17JQBOW5 on 2026-11-01 08:38:24 from Commercial Bank of Ethiopia to your telebirr Account 251989972336 - SAMUEL MIFITA AWOL. Your current balance is ETB 376.75.';
const ordinary = 'Dear Customer, Your account 1********2293 has been credited with ETB 100.00 on 01/11/2026 at 08:38:24. Your current balance is ETB 1,000.00. Thank you for banking with CBE.';
const wallet = (id: string, balance: number, last4: string): Wallet => ({ id,name:id,icon:'wallet',providerId:id,currency:'ETB',openingBalance:balance,balance,accountNumberLast4:last4,isDefault:false,isArchived:false,createdAt:date });
const message = (body: string, sender='CBE',id='message'): IncomingSms => ({ id,body,sender,receivedAt:Date.parse(date) });

describe('Automatic SMS atomic persistence (actual host SQLite)', () => {
    let fixture: ReturnType<typeof createSqliteFixture>;
    let repository: typeof import('../database');
    let context: ImportContext;
    beforeEach(async () => {
        fixture=createSqliteFixture(); jest.resetModules();
        jest.doMock('expo-sqlite',()=>({ openDatabaseAsync: () => fixture.open() }));
        repository=require('../database');
        await repository.initDatabase();
        const wallets = [wallet('cbe',368052.94,'2293'),wallet('telebirr',6.75,'2336')];
        for (const item of wallets) await repository.insertWalletDB(item);
        context={wallets,categories:defaultCategories,knownAccounts:[],merchants:[],merchantRules:[],educationInstitutions:[]};
    });
    afterEach(()=>{fixture.dispose();jest.dontMock('expo-sqlite');});
    it('imports once across history/live redelivery and process death after commit before acknowledgement',async()=>{
        const plan=buildImportPlan(message(ordinary),context);
        expect(await repository.applySmsImportPlanDB('message',plan)).toBe('imported');
        expect(await repository.applySmsImportPlanDB('message',plan)).toBe('duplicate');
        expect(await repository.applySmsImportPlanDB('live-copy',buildImportPlan(message(ordinary,'CBE','live-copy'),context))).toBe('duplicate');
        expect(await repository.getTransactionsDB()).toHaveLength(1);
        expect((await repository.getWalletsDB()).find(w=>w.id==='cbe')?.balance).toBe(368152.94);
        expect((await (await repository.getDatabase()).getAllAsync('SELECT * FROM sms_import_receipts')).length).toBe(2);
    });
    it('rolls back all financial changes and receipt on a failed handoff; retry applies once',async()=>{
        const plan=buildImportPlan(message(ordinary),context);
        fixture.setIntercept(event=>{if(event.sql.startsWith('INSERT INTO sms_import_receipts')) throw Error('disk full');});
        await expect(repository.applySmsImportPlanDB('message',plan)).rejects.toThrow('disk full');
        expect(await repository.getTransactionsDB()).toHaveLength(0);
        expect((await repository.getWalletsDB()).find(w=>w.id==='cbe')?.balance).toBe(368052.94);
        fixture.setIntercept();
        expect(await repository.applySmsImportPlanDB('message',plan)).toBe('imported');
    });
    it('commits the actual 370 transfer plus 12 fee atomically and recovers either arrival order',async()=>{
        const {confirmQueuedTransfer}=require('../../sms/automatic/transfers');
        const debit=message(cbe,'CBE','debit'); const credit=message(telebirr,'telebirr','credit');
        await confirmQueuedTransfer(debit,credit,context);
        await confirmQueuedTransfer(debit,credit,context);
        const transactions=await repository.getTransactionsDB();
        expect(transactions).toHaveLength(3);
        expect(transactions.filter(t=>t.isTransfer).map(t=>t.amount)).toEqual([370,370]);
        expect(transactions.find(t=>t.subType==='FEE')?.amount).toBe(12);
        expect(transactions.find(t=>t.type==='DEBIT' && t.isTransfer)?.vatAmount).toBe(1.5);
        expect(transactions.find(t=>t.subType==='FEE')?.note).toContain('Disaster recovery: ETB 0.50');
        expect(transactions.filter(isEarnedIncome)).toHaveLength(0);
        expect(transactions.filter(isPersonalSpending).reduce((total,t)=>total+t.amount,0)).toBe(12);
        expect((await repository.getWalletsDB()).find(w=>w.id==='cbe')?.balance).toBeCloseTo(367670.94,2);
        expect((await repository.getWalletsDB()).find(w=>w.id==='telebirr')?.balance).toBe(376.75);
        expect(transactions.every(t=>!('rawSms' in t))).toBe(true);
    });
    it('imports an external debit and its stated fees together, rolling both back on failure', async () => {
        const body = cbe + ' Transfer to account 100099998888 (Abebe Bikila).';
        const plan = buildImportPlan(message(body),context);
        expect(plan.status).toBe('imported');
        fixture.setIntercept(event => { if (event.sql.startsWith('INSERT INTO sms_import_receipts')) throw Error('disk full'); });
        await expect(repository.applySmsImportPlanDB('message',plan)).rejects.toThrow('disk full');
        expect(await repository.getTransactionsDB()).toHaveLength(0);
        fixture.setIntercept();
        await repository.applySmsImportPlanDB('message',plan);
        const txs = await repository.getTransactionsDB();
        expect(txs.map(t=>t.amount).sort((a,b)=>a-b)).toEqual([12,370]);
        expect((await repository.getWalletsDB()).find(w=>w.id==='cbe')?.balance).toBe(367670.94);
    });
    it('commits a manually reviewed queue receipt with its transaction', async () => {
        const plan = buildImportPlan(message(ordinary),context);
        await repository.insertTransactionDB({ ...plan.transaction!,amount:120 }, 'reviewed-message');
        expect(await repository.hasSmsImportReceiptDB('reviewed-message')).toBe(true);
        await expect(repository.insertTransactionDB({ ...plan.transaction!,id:'another' }, 'reviewed-message')).rejects.toThrow('already been imported');
        expect(await repository.getTransactionsDB()).toHaveLength(1);
    });
    it('executes the iOS adapter context queries and generated financial SQL against the real schema', async () => {
        const native = fixture.connections[0].native;
        // This validates the SQL contract on host SQLite; it is not a Swift/JSC or iPhone test.
        const swift = readFileSync('modules/bankoni-sms/ios/SmsEngine.swift','utf8');
        const adapterContext: Record<string, unknown> = {};
        for (const match of swift.matchAll(/"(\w+)": try vault\.rows\("([^"]+)"\)/g)) adapterContext[match[1]] = native.prepare(match[2]).all();
        expect(Object.keys(adapterContext)).toHaveLength(6);
        const sandbox: any = {};
        runInNewContext(readFileSync('modules/bankoni-sms/ios/Resources/sms-engine.js','utf8'),sandbox);
        const plan = JSON.parse(JSON.stringify(sandbox.BanKoniSmsEngine.buildImportPlan(message(ordinary),adapterContext)));
        expect(plan.status).toBe('imported');
        const writer = fixture.connections[0].native;
        writer.exec('PRAGMA query_only = OFF; BEGIN IMMEDIATE;');
        try { for (const command of plan.commands) writer.prepare(command.sql).run(...command.params); writer.exec('COMMIT;'); }
        catch (e) { writer.exec('ROLLBACK;'); throw e; }
        finally { writer.exec('PRAGMA query_only = ON;'); }
        expect(await repository.getTransactionsDB()).toHaveLength(1);
        expect(await repository.hasSmsImportReceiptDB('message')).toBe(true);
    });
    it('scopes reference guards to account and direction while blocking case-variant redelivery', async () => {
        const tx = buildImportPlan(message(ordinary),context).transaction!;
        await repository.insertTransactionDB({ ...tx,id:'ref-one',smsFingerprint:undefined,smsReference:'SHAREDREF' });
        await expect(repository.insertTransactionDB({ ...tx,id:'ref-case',smsFingerprint:undefined,smsReference:'sharedref' })).rejects.toThrow('already been imported');
        await repository.insertTransactionDB({ ...tx,id:'ref-other-account',walletId:'telebirr',smsFingerprint:undefined,smsReference:'SHAREDREF' });
        await repository.insertTransactionDB({ ...tx,id:'ref-other-direction',type:'DEBIT',categoryId:'cat-14',smsFingerprint:undefined,smsReference:'SHAREDREF' });
        expect(await repository.getTransactionsDB()).toHaveLength(3);
    });
    it('serializes concurrent duplicate handoffs at the persistence layer',async()=>{
        const plan=buildImportPlan(message(ordinary),context);
        const results=await Promise.all([repository.applySmsImportPlanDB('message',plan),repository.applySmsImportPlanDB('message',plan)]);
        expect(results.sort()).toEqual(['duplicate','imported']);
    });
    it('keeps two same-amount, no-reference transactions at different times',async()=>{
        await repository.applySmsImportPlanDB('one',buildImportPlan(message(ordinary,'CBE','one'),context));
        const later=ordinary.replace('08:38:24','09:38:24');
        await repository.applySmsImportPlanDB('two',buildImportPlan(message(later,'CBE','two'),context));
        expect(await repository.getTransactionsDB()).toHaveLength(2);
    });
});
