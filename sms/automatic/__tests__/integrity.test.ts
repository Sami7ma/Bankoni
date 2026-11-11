import { describe, it, expect, jest } from '@jest/globals';
import { buildImportPlan, type ImportContext, type IncomingSms } from '../plan';
import { SOURCE_CATALOG, selectedSource, normalizeSender } from '../../sources';
import { parseEthiopianDateTime } from '../../cleaners';
import { parseManualEventDate, resolveEventTime } from '../../eventTime';
import { readExportedMessages } from '../exportedMessages';
import * as parsers from '../../index';
import { defaultCategories } from '../../../constants/defaultCategories';

// Sanitized CBE format already covered by the application's CBE fixtures.
const credit = 'Dear Customer, Your account 1********2293 has been credited with ETB 100.00 on 01/11/2026 at 08:38:24. Your current balance is ETB 1,000.00. Thank you for banking with CBE.';
const receivedAt = Date.parse('2026-11-02T08:00:00+03:00');
const now = Date.parse('2026-11-04T12:00:00+03:00');
const wallet = { id:'my-cbe', name:'My CBE', providerId:'cbe', currency:'ETB', accountNumberLast4:'2293', icon:'wallet', balance:0, openingBalance:0, isArchived:false, isDefault:true, createdAt:new Date(now).toISOString() };
const source = { ...SOURCE_CATALOG[0], selected:true, automatic:true, walletId:wallet.id };
const context: ImportContext = { wallets:[wallet], categories:defaultCategories, knownAccounts:[], merchants:[], merchantRules:[], educationInstitutions:[], sources:[source] };
const incoming = (overrides: Partial<IncomingSms> = {}): IncomingSms => ({ id:'inbox-123', body:credit, sender:' Cbe ', receivedAt, source:'live', walletId:wallet.id, providerId:'cbe', ...overrides });

describe('Exact financial source authorization', () => {
    it.each([{sources:[]},{sources:[{...source,selected:false}]},{sources:[{...source,automatic:false}]},{sources:[{...source,walletId:null}]}])('does not invoke a parser without a selected linked source: %j', ({sources}) => {
        const spy=jest.spyOn(parsers,'parseSms');
        try { expect(buildImportPlan(incoming(),{...context,sources},now).status).toBe('skipped'); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
    });
    it.each(['friend','CBE promotions','not-CBE','CBE123','telebirr'])('does not parse an unknown or unselected sender: %s', sender => {
        const spy=jest.spyOn(parsers,'parseSms');
        try { expect(buildImportPlan(incoming({sender}),context,now).commands).toEqual([]); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
    });
    it('maps exact configured aliases to the selected account and rejects stale bindings', () => {
        const explicit={...source,senderIds:['CBE','CBE-ACCOUNT']};
        expect(normalizeSender(' cbe ')).toBe('CBE');
        expect(selectedSource(' cbe-account ',[explicit],context.wallets)?.walletId).toBe(wallet.id);
        expect(buildImportPlan(incoming({walletId:'other'}),context,now).status).toBe('skipped');
        expect(buildImportPlan(incoming(),{...context,wallets:[{...wallet,accountNumberLast4:'9999'}]},now).status).toBe('review');
        expect(selectedSource('CBE',[source,{...source,id:'collision'}],context.wallets)).toBeUndefined();
    });
    it('deselecting never creates ledger commands and does not propose deletion of existing transactions', () => {
        expect(buildImportPlan(incoming(),context,now).status).toBe('imported');
        const plan=buildImportPlan(incoming(),{...context,sources:[{...source,selected:false}]},now);
        expect(plan.status).toBe('skipped'); expect(plan.commands).toEqual([]);
    });
    it('filters unselected senders before the file financial classifier', () => {
        const rows=[incoming(),incoming({sender:'private-contact'})];
        expect(readExportedMessages(JSON.stringify(rows),now,[source])).toHaveLength(1);
        expect(readExportedMessages(JSON.stringify(rows),now,[])).toEqual([]);
    });
});

describe('SMS event, receive and import time integrity', () => {
    it('keeps all three timestamps distinct and emits integer validated financial metadata', () => {
        const plan=buildImportPlan(incoming(),context,now);
        expect(plan.status).toBe('imported');
        expect(plan.normalized).toMatchObject({provider:'cbe',senderId:' Cbe ',destinationAccount:wallet.id,amountMinor:10000,currency:'ETB',direction:'credit',confidence:'validated',occurredAt:Date.parse('2026-11-01T08:38:24+03:00'),receivedAt,importedAt:now});
        expect(plan.transaction?.createdAt).toBe(new Date(now).toISOString());
        expect(plan.transaction?.dateSource).toBe('sms_event');
    });
    it('uses original received milliseconds when the bank supplied no date, even after delayed import', () => {
        const plan=buildImportPlan(incoming({body:credit.replace(' on 01/11/2026 at 08:38:24','')}),context,now);
        expect(plan.transaction?.occurredAt).toBe(receivedAt); expect(plan.transaction?.importedAt).toBe(now);
        expect(plan.transaction?.dateSource).toBe('sms_received');
    });
    it.each([receivedAt/1000,receivedAt*1000,NaN,0,now+86400000])('rejects unreliable received timestamp %s', timestamp => {
        expect(buildImportPlan(incoming({receivedAt:timestamp}),context,now).status).toBe('review');
    });
    it.each(['31/02/2026','29/02/2025','32/01/2026','01/13/2026','01/11/123','01/01/2026 at 13:00 PM','01/01/2026 at 00:00 AM'])('rejects impossible calendar/time value %s', date => expect(parseEthiopianDateTime(date)).toBeNull());
    it('accepts a leap day and preserves bank-local time as an epoch', () => {
        expect(parseEthiopianDateTime('29/02/2024 23:59:59')).toBe('2024-02-29T23:59:59+03:00');
        expect(resolveEventTime('credited on 29/02/2024 23:59:59',Date.parse('2024-03-01T00:10:00+03:00'),undefined,now)).toMatchObject({valid:true,occurredAt:Date.parse('2024-02-29T23:59:59+03:00')});
    });
    it('does not replace an invalid explicit date with the valid received date', () => {
        expect(buildImportPlan(incoming({body:credit.replace('01/11/2026','31/02/2026')}),context,now).status).toBe('review');
        expect(buildImportPlan(incoming({body:credit.replace('01/11/2026','01-11-2026')}),context,now).status).toBe('review');
    });
    it('requires a real calendar date and explicit timezone for manual historical corrections', () => {
        expect(parseManualEventDate('2026-02-31T08:00:00+03:00',now)).toBeNull();
        expect(parseManualEventDate('2026-11-01T08:00:00',now)).toBeNull();
        expect(parseManualEventDate('2026-11-01T08:00:00+99:00',now)).toBeNull();
        expect(parseManualEventDate('2026-11-01T08:00:00+03:00',now)).toBe(Date.parse('2026-11-01T08:00:00+03:00'));
    });
    it('infers missing year relative to receipt across New Year, and holds ambiguous dates', () => {
        const receipt=Date.parse('2026-01-01T00:10:00+03:00');
        expect(resolveEventTime('paid on 31/12 at 23:59',receipt,undefined,now)).toMatchObject({valid:true,occurredAt:Date.parse('2025-12-31T23:59:00+03:00')});
        expect(resolveEventTime('paid on 30/06',receipt,undefined,now).valid).toBe(false);
    });
    it('filters actual event dates at the rolling history boundary rather than receipt/import dates', () => {
        const message=incoming({source:'history',windowStart:Date.parse('2026-11-01T08:38:24+03:00'),windowEnd:now});
        expect(buildImportPlan(message,context,now).status).toBe('imported');
        expect(buildImportPlan({...message,windowStart:message.windowStart!+1},context,now).status).toBe('skipped');
        expect(buildImportPlan({...message,windowStart:undefined},context,now).status).toBe('review');
    });
    it.each(['Your current balance is ETB 500.00. CBE','Your OTP is 123456 for ETB 100 payment','Your PIN: 123456 for ETB 100 payment','Password 123456 for ETB 100 transaction','Your payment of ETB 100 was declined. CBE','Special promotion: ETB 100 discount offer. Your Current balance ETB 500. CBE','Login alert: Your account credited ETB 100. CBE'])('never turns notification text into a ledger entry: %s', body => {
        const plan=buildImportPlan(incoming({body}),context,now); expect(plan.status).toBe('skipped'); expect(plan.commands).toEqual([]);
    });
    it.each(['Refund','Reversal'])('holds %s credits until the original movement is confirmed', kind => {
        const plan=buildImportPlan(incoming({body:`${credit} ${kind} of previous transaction.`}),context,now);
        expect(plan.status).toBe('review'); expect(plan.commands).toEqual([]);
    });
    it('keeps the existing heuristic Telebirr fallback available for review without automatically posting it', () => {
        // Existing telebirr.test.ts generic debit fixture, not a newly verified automatic template.
        const body='Your account has been debited with ETB 250.00 on 23/10/2026 14:15:00 for payment to Tomoca Coffee. Your transaction number is DJN999. Your current E-Money Account balance is ETB 500.00. Ethio telecom';
        const teleWallet={...wallet,id:'tele',providerId:'telebirr',accountNumberLast4:undefined};
        const teleSource={...SOURCE_CATALOG[2],selected:true,automatic:true,walletId:teleWallet.id};
        const plan=buildImportPlan(incoming({body,sender:'telebirr',walletId:'tele',providerId:'telebirr'}),{...context,wallets:[teleWallet],sources:[teleSource]},now);
        expect(plan.status).toBe('review');expect(plan.candidate?.automaticEligible).toBe(false);expect(plan.commands).toEqual([]);
    });
    it('never automatically posts a BOA credit format labelled provisional by the existing parser', () => {
        const body='Dear Customer, your account 1000****5678 was credited with ETB 100.00 from ABEBE. Available Balance: ETB 500.00. Bank of Abyssinia.';
        const boaWallet={...wallet,id:'boa',providerId:'boa',accountNumberLast4:'5678'};
        const boaSource={...SOURCE_CATALOG[4],selected:true,automatic:true,walletId:'boa'};
        const plan=buildImportPlan(incoming({body,sender:'BOA',walletId:'boa',providerId:'boa'}),{...context,wallets:[boaWallet],sources:[boaSource]},now);
        expect(plan.status).toBe('review');expect(plan.commands).toEqual([]);
    });
});
