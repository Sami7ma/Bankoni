import { describe,it,expect,jest } from '@jest/globals';
import { authorizeWalletSource, selectedSource, rollingImportWindow, SOURCE_CATALOG } from '../../sources';
import { buildImportPlan, type ImportContext, type IncomingSms } from '../plan';
import { defaultCategories } from '../../../constants/defaultCategories';
import { resolveEventTime } from '../../eventTime';
import { eventTimestamp, transactionDay, formatTransactionDate } from '../../../utils/ledger';
import { ledgerReport, reportingRange } from '../../../utils/reporting';
import * as parsers from '../../index';
import type { Wallet } from '../../../types/Wallet';

const now=Date.parse('2026-11-04T12:00:00+03:00');
const received=Date.parse('2026-11-04T09:00:00+03:00');
const wallet:Wallet={id:'my-cbe',name:'CBE Savings',providerId:'cbe',currency:'ETB',openingBalance:1000,balance:1000,icon:'wallet',accountNumberLast4:'1234',isDefault:true,isArchived:false,createdAt:new Date(now).toISOString()};
const tele:Wallet={...wallet,id:'tele',providerId:'telebirr',name:'Telebirr',accountNumberLast4:'5678'};
// Existing sanitized CBE credit template, varying the date to exercise delayed delivery.
const body='Dear Customer, Your account 1000****1234 has been credited with ETB 370.00 on 18/10/2026 at 08:38:24. Your current balance is ETB 1,000.00. Thank you for banking with CBE.';
const sources=authorizeWalletSource([],wallet,['CBE'],false);
const context:ImportContext={wallets:[wallet,tele],sources,categories:defaultCategories,knownAccounts:[],merchantRules:[],merchants:[],educationInstitutions:[]};
const message=(extra:Partial<IncomingSms>={}):IncomingSms=>({id:'sms-1',body,sender:'CBE',walletId:wallet.id,providerId:'cbe',source:'history',receivedAt:received,hasTransportIdentity:true,windowStart:rollingImportWindow(now).start,windowEnd:now,...extra});

describe('Wallet-centred authorization and import',()=>{
    it('authorizes no alias merely by selecting a provider or creating an account',()=>{
        expect(SOURCE_CATALOG.every(s=>!s.selected && !s.walletId)).toBe(true);
        expect(()=>authorizeWalletSource([],wallet,[],false)).toThrow('exact sender');
    });
    it('saves an explicit CBE mapping and adds Telebirr without altering it',()=>{
        const next=authorizeWalletSource(sources,tele,['telebirr'],true);
        expect(next[0]).toEqual(sources[0]);expect(next).toHaveLength(2);
        expect(selectedSource(' CBE ',next,[wallet,tele],false)?.walletId).toBe(wallet.id);
        expect(selectedSource('telebirr',next,[wallet,tele])?.walletId).toBe(tele.id);
    });
    it('rejects conflicting aliases even if future automatic reception is off',()=>{
        expect(()=>authorizeWalletSource(sources,{...wallet,id:'another'},['cbe'],false)).toThrow('another account');
    });
    it('allows a one-time history import independently of live reception',()=>{
        expect(buildImportPlan(message(),context,now).status).toBe('imported');
        expect(buildImportPlan(message({source:'live'}),context,now).status).toBe('skipped');
    });
    it('rejects an unselected sender before parsing or exposing it',()=>{
        const spy=jest.spyOn(parsers,'parseSms');
        try{expect(buildImportPlan(message({sender:'friend'}),context,now).commands).toEqual([]);expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
    });
    it('enforces the bound wallet even for another authorized financial sender',()=>{
        const both=authorizeWalletSource(sources,tele,['telebirr'],true);
        expect(buildImportPlan(message({sender:'telebirr'}),{...context,sources:both},now).status).toBe('skipped');
    });
    it('uses a calendar-clamped rolling year down to the current time',()=>{
        const end=new Date(2026,10,4,17,22,33,123).getTime();
        expect(rollingImportWindow(end)).toEqual({start:new Date(2025,10,4,17,22,33,123).getTime(),end});
        const leap=new Date(2024,1,29,10,22).getTime();
        expect(rollingImportWindow(leap).start).toBe(new Date(2023,1,28,10,22).getTime());
    });
    it('keeps October 18 event, November 4 receipt and import distinct across every consumer',()=>{
        const plan=buildImportPlan(message(),context,now);expect(plan.status).toBe('imported');
        const tx=plan.transaction!;
        expect(tx).toMatchObject({walletId:wallet.id,occurredAt:Date.parse('2026-10-18T08:38:24+03:00'),receivedAt:received,importedAt:now,dateSource:'sms_event',datePrecision:'second'});
        expect(transactionDay(tx)).toBe('2026-10-18');
        expect(formatTransactionDate(tx,{day:'numeric',month:'long'})).toMatch(/18/);
        const oct=ledgerReport([tx],[wallet],reportingRange('Custom',new Date(now),{start:'2026-10-01',end:'2026-10-31'}));
        const nov=ledgerReport([tx],[wallet],reportingRange('Custom',new Date(now),{start:'2026-11-01',end:'2026-11-30'}));
        expect(oct.incomeMinor).toBe(37000);expect(nov.incomeMinor).toBe(0);
    });
    it('preserves a date-only event and never claims midnight was measured',()=>{
        const tx=buildImportPlan(message({body:body.replace(' at 08:38:24','')}),context,now).transaction!;
        expect(tx).toMatchObject({datePrecision:'day',eventDate:'2026-10-18',dateSource:'sms_event'});
        expect(transactionDay(tx)).toBe('2026-10-18');
        expect(new Date(eventTimestamp(tx)).getHours()).toBe(0); // local calendar bucket anchor only
    });
    it.each(['31/02/2026','10-18-2026','2026/10/18'])('does not replace impossible or unverified explicit dates: %s',date=>{
        expect(buildImportPlan(message({body:body.replace('18/10/2026',date)}),context,now).status).toBe('review');
    });
    it('does not guess Ethiopian-calendar dates from Gregorian templates',()=>{
        expect(buildImportPlan(message({body:body.replace('18/10/2026','18/10/2019 E.C.')}),context,now).status).toBe('review');
    });
    it('requires provider-specific conventions; BOA date additions are not verified templates',()=>{
        expect(resolveEventTime('was debited ETB 370 on 18/10/2026',received,undefined,now,'boa').valid).toBe(false);
        expect(resolveEventTime('paid on 10/18/2026',received,undefined,now,'cbe').valid).toBe(false);
    });
    it('preserves original receive fallback when a verified format has no explicit date',()=>{
        const plan=buildImportPlan(message({body:body.replace(' on 18/10/2026 at 08:38:24','')}),context,now);
        expect(plan.transaction).toMatchObject({occurredAt:received,dateSource:'sms_received',importedAt:now});
    });
    it('groups known date/time at local midnight, not UTC date or import time',()=>{
        const tx=buildImportPlan(message({body:body.replace('08:38:24','00:01:00')}),context,now).transaction!;
        expect(transactionDay(tx)).toBe('2026-10-18'); // CBE bank-local day is stable on every device.
        expect(transactionDay(tx)).not.toBe('2026-11-04');
    });
    it('attributes a verified Dashen debit to October spending, not November receipt',()=>{
        const dashen={...wallet,id:'dashen',providerId:'dashen'};
        const debit="Dear Customer, your account '1000****1234' is debited with ETB 1,000.00 on 18/10/2026 at 04:10:28 PM. Your current balance is ETB 2,938.38. Dashen Bank - Always one step ahead!";
        const plan=buildImportPlan(message({body:debit,sender:'Dashen',walletId:'dashen',providerId:'dashen'}),{...context,wallets:[dashen],sources:authorizeWalletSource([],dashen,['Dashen'],false)},now);
        expect(plan.status).toBe('imported');expect(transactionDay(plan.transaction!)).toBe('2026-10-18');
        const oct=ledgerReport([plan.transaction!],[dashen],reportingRange('Custom',new Date(now),{start:'2026-10-01',end:'2026-10-31'}));
        const nov=ledgerReport([plan.transaction!],[dashen],reportingRange('Custom',new Date(now),{start:'2026-11-01',end:'2026-11-30'}));
        expect(oct.spendingMinor).toBe(100000);expect(nov.spendingMinor).toBe(0);
    });

    it.each(['18/10/2026 at 08.38 PM','18/10/2026 08:38:24+00:00','18/10/2026 and 19/10/2026','18/10/26'])('requires review rather than truncating or guessing unsupported event dates: %s',date=>{
        expect(buildImportPlan(message({body:body.replace('18/10/2026 at 08:38:24',date)}),context,now).status).toBe('review');
    });

});
