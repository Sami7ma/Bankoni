import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createSqliteFixture } from './sqliteFixture';
import { analyse, makeEnvelope, emptyContext, messageId } from '../../sms/companion/core';
const date='2026-11-01T05:38:24Z';
const credit='Dear Customer, Your account 1********2293 has been credited with ETB 100.00 on 01/11/2026 at 08:38:24. Your current balance is ETB 1,000.00. Thank you for banking with CBE.';
const evidence=(body=credit,sender='CBE',receivedAt=Date.parse(date))=>({body,sender,receivedAt});
const file=(messages:ReturnType<typeof evidence>[])=>JSON.stringify(makeEnvelope(messages.map(row=>analyse(row)!).filter(Boolean)));

describe('Scriptable handoff into the existing SQLite vault',()=>{
    let fixture:ReturnType<typeof createSqliteFixture>,repo:typeof import('../database'),handoff:typeof import('../../sms/companion/import');
    beforeEach(async()=>{
        fixture=createSqliteFixture();jest.resetModules();
        jest.doMock('expo-sqlite',()=>({openDatabaseAsync:()=>fixture.open()}));
        jest.doMock('expo-modules-core',()=>({requireOptionalNativeModule:()=>null}));
        repo=require('../database');handoff=require('../../sms/companion/import');
        await repo.initDatabase();
        await repo.insertWalletDB({id:'cbe',name:'CBE',providerId:'cbe',accountNumberLast4:'2293',currency:'ETB',icon:'wallet',openingBalance:368052.94,balance:368052.94,isDefault:true,isArchived:false,createdAt:date});
    });
    afterEach(()=>{fixture.dispose();jest.dontMock('expo-sqlite');jest.dontMock('expo-modules-core');});
    it('imports once, rejects forged financial previews and reports repeated batches as duplicates',async()=>{
        const envelope=JSON.parse(file([evidence()]));envelope.records[0].summary.principalSantim=99999999;envelope.records[0].commands=[{sql:'DELETE FROM users'}];
        const result=await handoff.importCompanionFile(JSON.stringify(envelope));
        expect(result.imported).toBe(1);expect((await repo.getTransactionsDB())[0].amount).toBe(100);
        expect((await repo.getWalletsDB()).find(w=>w.id==='cbe')?.balance).toBe(368152.94);
        expect((await handoff.importCompanionFile(JSON.stringify(envelope))).duplicate).toBe(1);
        expect(await repo.getTransactionsDB()).toHaveLength(1);
        const row=await (await repo.getDatabase()).getFirstAsync<{body:string}>('SELECT body FROM scriptable_sms_inbox;');expect(row?.body).toBe('');
    });
    it('deduplicates across the existing Android/manual ledger handoff',async()=>{
        const {buildImportPlan}=require('../../sms/automatic/plan');
        const context={...emptyContext,wallets:await repo.getWalletsDB(),categories:await repo.getCategoriesDB()};
        await repo.applySmsImportPlanDB('android-message',buildImportPlan({...evidence(),id:'android-message'},context));
        expect((await handoff.importCompanionFile(file([evidence()]))).duplicate).toBe(1);
        expect(await repo.getTransactionsDB()).toHaveLength(1);
    });
    it('rolls back an interrupted inbox batch before any financial insertion and safely replays the file',async()=>{
        let inserts=0;
        fixture.setIntercept(event=>{if(event.sql.startsWith('INSERT OR IGNORE INTO scriptable_sms_inbox')&&++inserts===2)throw Error('interrupted batch');});
        const raw=file([evidence(),evidence(credit.replace('100.00','200.00'))]);
        await expect(handoff.importCompanionFile(raw)).rejects.toThrow('interrupted batch');
        expect(await repo.getScriptableInboxDB()).toHaveLength(0);expect(await repo.getTransactionsDB()).toHaveLength(0);
        fixture.setIntercept();expect((await handoff.importCompanionFile(raw)).imported).toBe(2);
    });
    it('recovers a failed financial transaction without partial balances/receipts or duplicate fees',async()=>{
        fixture.setIntercept(event=>{if(event.sql.startsWith('INSERT INTO sms_import_receipts'))throw Error('disk full');});
        expect((await handoff.importCompanionFile(file([evidence()]))).failed).toBe(1);
        expect(await repo.getTransactionsDB()).toHaveLength(0);
        expect((await repo.getWalletsDB()).find(w=>w.id==='cbe')?.balance).toBe(368052.94);
        expect(await repo.getScriptableInboxDB()).toHaveLength(1);
        fixture.setIntercept();
        expect((await handoff.retryCompanionInbox()).imported).toBe(1);
        expect((await handoff.retryCompanionInbox()).imported).toBe(0);
    });
    it('recovers commit-before-queue-ack failure via the atomic existing receipt',async()=>{
        let blocked=true;
        fixture.setIntercept(event=>{if(blocked&&event.sql.startsWith('UPDATE scriptable_sms_inbox SET status='))throw Error('ack failed');});
        await handoff.importCompanionFile(file([evidence()]));
        expect(await repo.getTransactionsDB()).toHaveLength(1);
        blocked=false;fixture.setIntercept();
        expect((await handoff.retryCompanionInbox()).duplicate).toBe(1);
        expect(await repo.getTransactionsDB()).toHaveLength(1);
    });
    it('preserves uncertain transfers for confirmation and uses the existing atomic 370 + 12 transfer path',async()=>{
        await repo.insertWalletDB({id:'telebirr',name:'Telebirr',providerId:'telebirr',accountNumberLast4:'2336',currency:'ETB',icon:'wallet',openingBalance:6.75,balance:6.75,isDefault:false,isArchived:false,createdAt:date});
        const debit='Dear Samuel Mifta Awol A debit transaction of ETB 370.0. has occurred on your account 1********2293. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB382.00. Your current balance is ETB367,670.94.';
        const incoming='Dear SAMUEL, You have received ETB 370.00 by transaction number DK17JQBOW5 on 2026-11-01 08:38:24 from Commercial Bank of Ethiopia to your telebirr Account 251989972336 - SAMUEL MIFITA AWOL. Your current balance is ETB 376.75.';
        const messages=[evidence(incoming,'telebirr'),evidence(debit)];
        expect((await handoff.importCompanionFile(file(messages))).review).toBe(2);expect(await repo.getTransactionsDB()).toHaveLength(0);
        const {confirmQueuedTransfer}=require('../../sms/automatic/transfers');
        const {loadImportContext}=require('../../sms/automatic/processor');
        const rows=await repo.getScriptableInboxDB();
        await confirmQueuedTransfer(rows.find(r=>r.sender==='CBE'),rows.find(r=>r.sender==='telebirr'),await loadImportContext());
        await handoff.retryCompanionInbox();
        expect((await repo.getTransactionsDB()).map(t=>t.amount).sort((a,b)=>a-b)).toEqual([12,370,370]);
        expect((await repo.getWalletsDB()).find(w=>w.id==='cbe')?.balance).toBe(367670.94);
        expect((await repo.getWalletsDB()).find(w=>w.id==='telebirr')?.balance).toBe(376.75);
        expect((await handoff.importCompanionFile(file(messages))).duplicate).toBe(2);
    });
    it('keeps invalid dates for review, isolates bad rows, and preserves dismissal on repeated imports',async()=>{
        const envelope=JSON.parse(file([evidence()]));envelope.records.push({...envelope.records[0],receivedAt:'bad date'});envelope.records.push({body:55});
        const result=await handoff.importCompanionFile(JSON.stringify(envelope));
        expect(result.imported).toBe(1);expect(result.review).toBe(1);expect(result.invalid).toHaveLength(1);
        const row=(await repo.getScriptableInboxDB())[0];await repo.finishScriptableMessageDB(row.id,'dismissed','Dismissed');
        expect((await handoff.importCompanionFile(JSON.stringify(envelope))).skipped).toBe(1);
        expect((await repo.getScriptableInboxDB())).toHaveLength(0);
    });
    it('exports only explicit account context, without balances, PINs or full account numbers',async()=>{
        const exported=JSON.parse(await handoff.exportCompanionContext());expect(exported.wallets[0].balance).toBeUndefined();expect(exported.wallets[0].accountNumberLast4).toBe('2293');expect(exported.pinHash).toBeUndefined();
    });
    it('does not insert ETB evidence into a wallet denominated in another currency',async()=>{
        await repo.updateWalletDB('cbe',{currency:'USD'});
        expect((await handoff.importCompanionFile(file([evidence()]))).review).toBe(1);
        expect(await repo.getTransactionsDB()).toHaveLength(0);
    });
});
