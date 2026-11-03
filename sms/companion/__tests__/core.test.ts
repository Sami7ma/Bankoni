import { describe, it, expect } from '@jest/globals';
import { analyse, normalizeEvidence, messageId, digest, parseInput, makeEnvelope, readEnvelope, emptyContext, readContext } from '../core';
import { buildImportPlan, type ImportContext } from '../../automatic/plan';
import { createHash } from 'node:crypto';
const time=Date.parse('2026-11-01T05:38:24Z');
const credit='Dear Customer, Your account 1********2293 has been credited with ETB 100.00 on 01/11/2026 at 08:38:24. Your current balance is ETB 1,000.00. Thank you for banking with CBE.';
const evidence=(body=credit,sender='CBE')=>({body,sender,receivedAt:time});
const ctx:ImportContext={...emptyContext,wallets:[{id:'cbe',name:'CBE',providerId:'cbe',accountNumberLast4:'2293',currency:'ETB',icon:'wallet',balance:0,openingBalance:0,isDefault:true,isArchived:false,createdAt:new Date(time).toISOString()}]};
const cbe='Dear Samuel Mifta Awol A debit transaction of ETB 370.0. has occurred on your account 1********2293. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB382.00. Your current balance is ETB367,670.94.';

describe('Scriptable shared processing and transport',()=>{
    it('uses the existing monetary/reference/balance rules and integer santim',()=>{
        const row=analyse(evidence(),ctx)!;
        expect(row.status).toBe('pending');expect(row.summary).toMatchObject({principalSantim:10000,ledgerSantim:10000,balanceSantim:100000,accountLast4:'2293'});
        expect(row.fingerprint).toBe(buildImportPlan({...evidence(),id:row.id},ctx).transaction?.smsFingerprint);
    });
    it('holds the exact CBE fees and Telebirr own-account evidence for review',()=>{
        const row=analyse(evidence(cbe),ctx)!;
        expect(row.status).toBe('review');expect(row.summary).toMatchObject({principalSantim:37000,feesSantim:1200,ledgerSantim:38200,balanceSantim:36767094});
        const body='Dear SAMUEL, You have received ETB 370.00 by transaction number DK17JQBOW5 on 2026-11-01 08:38:24 from Commercial Bank of Ethiopia to your telebirr Account 251989972336 - SAMUEL MIFITA AWOL. Your current balance is ETB 376.75.';
        const result=analyse(evidence(body,'telebirr'))!;
        expect(result.status).toBe('review');expect(result.summary).toMatchObject({reference:'DK17JQBOW5',principalSantim:37000,balanceSantim:37675});
    });
    it.each([
        ['dashen',"Dear Customer, your account '1234****5678' is credited with ETB 230.00 from ABEBE BIKILA on 19/10/2026 at 12:22:25 PM. Your current balance is ETB 4,772.38. Dashen Bank - Always one step ahead!",23000],
        ['boa','Dear Customer, your account 1000****5678 was debited with ETB 1,006.00. Available Balance: ETB 10,862.76. Receipt: https://cs.bankofabyssinia.com/slip/?trx=FT2610ABCDEF Bank of Abyssinia.',100600],
        ['mpesa','Dear Customer, you have bought a Safaricom bundle of 160.00 Birr for 0712345678 on 21/10/26 at 12:37 PM. Transaction number MP2610BND002. Your current M-PESA balance is 282.00 Birr.',16000],
        ['awash','Dear Customer, your Account 1000****1234 has been Credited with ETB 2000.00 on 2026-10-14 08:32:28 by ABEBE BIKILA via IPS DASHEN BANK. Your balance now is ETB 34720.30. Awash Bank.',200000],
        ['telebirr','Dear Customer, You have paid ETB 250.00 to Merchant Tomoca Coffee on 23/10/2026 10:15:00. Your transaction number is TB9988. Your current balance is ETB 750.00. Thank you for using telebirr.',25000],
    ])('preserves %s parser templates',(provider,body,amount)=>{
        const result=analyse(evidence(String(body),String(provider)))!;
        expect(result.summary?.provider).toBe(provider);expect(result.summary?.principalSantim).toBe(amount);
    });
    it.each(['OTP123456 for ETB 100 payment from CBE','I paid ETB 100 to Alice yesterday','Payment declined: ETB 10.00','Dear Customer, CBE Birr airtime notification.'])('filters secrets, personal and non-ledger events: %s',body=>expect(analyse(evidence(body,'friend'))).toBeNull());
    it('retains unsupported financial formats and missing/ambiguous accounts for review',()=>{
        expect(analyse(evidence('ETB 100.00 deposited to your account. Balance ETB 500.00','UnknownBank'))?.status).toBe('review');
        expect(analyse(evidence())?.status).toBe('review');
        expect(analyse(evidence(),{...ctx,wallets:[ctx.wallets[0],{...ctx.wallets[0],id:'other'}]})?.status).toBe('review');
    });
    it('requires timestamps and does not invent a date for historical messages',()=>{
        expect(normalizeEvidence({...evidence(),receivedAt:'not a date'}).receivedAt).toBe(0);
        expect(normalizeEvidence({...evidence(),receivedAt:'2026-02-31T08:38:24+03:00'}).receivedAt).toBe(0);
        expect(normalizeEvidence({...evidence(),receivedAt:Math.floor(time/1000)}).receivedAt).toBe(0);
        expect(normalizeEvidence({...evidence(),receivedAt:'2026-11-01T08:38:24+03:00'}).receivedAt).toBe(time);
        expect(analyse({...evidence(),receivedAt:0},ctx)?.status).toBe('review');
        expect(()=>normalizeEvidence({...evidence(),body:credit+'\uD800'})).toThrow('Unicode');
    });
    it('generates stable UTF-8 SHA256 transport IDs without merging identical amounts on different dates',()=>{
        expect(digest('ብር ETB 10')).toBe(createHash('sha256').update('ብር ETB 10').digest('hex'));
        expect(messageId(evidence())).toBe(messageId({...evidence(),sender:' cbe ',body:' '+credit+' '}));
        expect(messageId(evidence())).not.toBe(messageId({...evidence(),receivedAt:time+1000}));
    });
    it('validates modes, rejects empty/oversized batches and supports JSON dictionary input',()=>{
        expect(parseInput(null).mode).toBe('dashboard');
        expect(parseInput(JSON.stringify({version:1,mode:'incoming_message',message:evidence()})).messages).toHaveLength(1);
        expect(()=>parseInput({version:1,mode:'history_import',messages:[]})).toThrow('No messages');
        expect(()=>parseInput({version:1,mode:'history_import',messages:Array(201).fill(evidence())})).toThrow('200');
        expect(()=>parseInput('unstructured message')).toThrow('dictionary');
        expect(()=>parseInput({version:2,mode:'dashboard'})).toThrow('version');
    });
    it('isolates malformed rows and ignores all supplied financial fields, IDs and SQL',()=>{
        const row=analyse(evidence(),ctx)!;
        const envelope=makeEnvelope([{...row,id:'untrusted',summary:{provider:'cbe',direction:'CREDIT',principalSantim:99999999,ledgerSantim:99999999,feesSantim:0}},{...row,body:42 as any}]);
        const result=readEnvelope(JSON.stringify(envelope));
        expect(result.records).toHaveLength(1);expect(result.errors).toHaveLength(1);
        expect(result.records[0].id).toBe(messageId(evidence()));expect(result.records[0].summary?.principalSantim).toBe(10000);
        expect(()=>readEnvelope('{bad')).toThrow('JSON');
        expect(()=>readEnvelope(JSON.stringify({...envelope,version:2}))).toThrow('version');
    });
    it('round trips 200 records with stable batch identity and validates account context',()=>{
        const rows=Array.from({length:200},(_,i)=>analyse({...evidence(),receivedAt:time+i})!);
        const exportFile=makeEnvelope(rows);expect(readEnvelope(JSON.stringify(exportFile)).records).toHaveLength(200);
        expect(makeEnvelope([...rows].reverse()).batchId).toBe(exportFile.batchId);
        expect(readContext(JSON.stringify({format:'bankoni.scriptable.context',version:1,wallets:ctx.wallets,categories:ctx.categories,knownAccounts:[]})).wallets[0].id).toBe('cbe');
    });
});
