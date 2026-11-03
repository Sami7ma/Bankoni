import { describe, it, expect, jest } from '@jest/globals';
import { buildImportPlan, isFinancialMessage, cents, type ImportContext, type IncomingSms } from '../plan';
import { defaultCategories } from '../../../constants/defaultCategories';
import { readExportedMessages } from '../exportedMessages';
import { transferSuggestion } from '../transfers';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';

// transfers imports the repository; native SQLite isn't used by these pure suggestions.
jest.mock('expo-sqlite', () => ({}));
const time = Date.parse('2026-11-01T05:38:24Z');
export const cbe = 'Dear Samuel Mifta Awol A debit transaction of ETB 370.0. has occurred on your account 1********2293. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB382.00. Your current balance is ETB367,670.94.';
export const telebirr = 'Dear SAMUEL, You have received ETB 370.00 by transaction number DK17JQBOW5 on 2026-11-01 08:38:24 from Commercial Bank of Ethiopia to your telebirr Account 251989972336 - SAMUEL MIFITA AWOL. Your current balance is ETB 376.75.';
export const context: ImportContext = {
    wallets: [
        { id: 'cbe', name: 'CBE', icon: 'wallet', providerId: 'cbe', accountNumberLast4: '2293', currency: 'ETB', isArchived: false, openingBalance: 368052.94, balance: 368052.94, isDefault: true, createdAt: new Date(time).toISOString() },
        { id: 'telebirr', name: 'Telebirr', icon: 'wallet', providerId: 'telebirr', accountNumberLast4: '2336', currency: 'ETB', isArchived: false, openingBalance: 6.75, balance: 6.75, isDefault: false, createdAt: new Date(time).toISOString() },
    ], categories: defaultCategories, knownAccounts: [], merchants: [], merchantRules: [], educationInstitutions: [],
};
export function message(body: string, sender = 'CBE', id = 'message'): IncomingSms { return { id, body, sender, receivedAt: time }; }
const ordinary = 'Dear Customer, Your account 1********2293 has been credited with ETB 100.00 on 01/11/2026 at 08:38:24. Your current balance is ETB 1,000.00. Thank you for banking with CBE.';

describe('Automatic SMS shared financial plan', () => {
    it('holds both exact transfer examples for explicit confirmation without adding income or spending', () => {
        const debit = buildImportPlan(message(cbe),context);
        const credit = buildImportPlan(message(telebirr,'telebirr'),context);
        expect(debit.status).toBe('review'); expect(credit.status).toBe('review');
        expect(debit.candidate?.fees).toEqual({ serviceCharge: 10, vat: 1.5, disasterFund: 0.5, totalFees: 12 });
        expect(debit.candidate?.ledgerAmount).toBe(382);
        expect(credit.candidate?.principalAmount).toBe(370);
        expect(debit.commands).toEqual([]); expect(credit.commands).toEqual([]);
    });
    it('detects the exact CBE fee template even without a named sender or CBE footer', () => {
        const plan = buildImportPlan(message(cbe,'bank-header'),context);
        expect(plan.candidate?.providerId).toBe('cbe'); expect(plan.candidate?.ledgerAmount).toBe(382);
        expect(plan.status).toBe('review');
    });
    it('suggests the two messages only inside a bounded time window and matching accounts', () => {
        const suggestion = transferSuggestion(message(cbe),message(telebirr,'telebirr'),context)!;
        expect(suggestion.principal).toBe(37000); expect(suggestion.fees).toBe(1200);
        expect(transferSuggestion({ ...message(cbe),receivedAt:time-86400000 },message(telebirr,'telebirr'),context)).toBeNull();
        expect(transferSuggestion(message(cbe),message(telebirr,'telebirr'),{ ...context, wallets: context.wallets.map(w => ({ ...w, accountNumberLast4: '9999' })) })).toBeNull();
    });
    it('creates a valid plan for a straightforward bank credit', () => {
        const plan = buildImportPlan(message(ordinary),context);
        expect(plan.status).toBe('imported');
        expect(plan.transaction?.amount).toBe(100); expect(plan.transaction?.date).toContain('2026-11-01');
        expect(plan.commands.at(-2)?.params).toEqual([10000,'cbe']);
        expect(plan.commands[0].sql).toContain('NULL'); // raw_sms is never retained in the ledger
    });
    it('requires review for unknown/ambiguous accounts, invalid totals, and unsupported providers', () => {
        expect(buildImportPlan(message(ordinary),{ ...context,wallets:[] }).status).toBe('review');
        expect(buildImportPlan(message(ordinary.replace('2293','8888')),context).status).toBe('review');
        expect(buildImportPlan(message('ETB 100.00 deposited to your account. Balance ETB 500.00','UnknownBank'),context).status).toBe('review');
    });
    it.each(['Your OTP is 123456. ETB 100 paid.', 'OTP123456 for ETB 100 payment from CBE', 'Verification code: 123456 for ETB 100 transaction', 'Call me tomorrow', 'ATM withdrawal secret code is 123456', 'Payment declined: ETB 10.00'])('filters unrelated, authentication and unsuccessful messages: %s', body => {
        expect(buildImportPlan(message(body),context).status).toBe('skipped');
    });
    it('computes currency with integer santim', () => {
        expect(cents(370)+cents(10)+cents(1.5)+cents(0.5)).toBe(38200);
        expect(cents(0.29)).toBe(29);
    });
    it.each([
        ['dashen', "Dear Customer, your account '1234****5678' is credited with ETB 230.00 from ABEBE BIKILA on 19/10/2026 at 12:22:25 PM. Your current balance is ETB 4,772.38. Dashen Bank - Always one step ahead!", '5678', 230],
        ['boa', 'Dear Customer, your account 1000****5678 was debited with ETB 1,006.00. Available Balance: ETB 10,862.76. Receipt: https://cs.bankofabyssinia.com/slip/?trx=FT2610ABCDEF Bank of Abyssinia.', '5678', 1006],
        ['mpesa', 'Dear Customer, you have bought a Safaricom bundle of 160.00 Birr for 0712345678 on 21/10/26 at 12:37 PM. Transaction number MP2610BND002. Your current M-PESA balance is 282.00 Birr.', '5678', 160],
        ['telebirr', 'Dear Customer, You have paid ETB 250.00 to Merchant Tomoca Coffee on 23/10/2026 10:15:00. Your transaction number is TB9988. Your current balance is ETB 750.00. Thank you for using telebirr.', '', 250],
    ] as const)('automatically persists supported %s formats through the shared plan', (provider, body, last4, amount) => {
        const wallet = { ...context.wallets[0], id: provider, providerId: provider, accountNumberLast4: last4 };
        const plan = buildImportPlan(message(body,provider), { ...context,wallets:[wallet] });
        expect(plan.status).toBe('imported'); expect(plan.transaction?.amount).toBe(amount);
    });
    it('retains Awash interbank ownership uncertainty rather than assuming income', () => {
        const body = 'Dear Customer, your Account 1000****1234 has been Credited with ETB 2000.00 on 2026-10-14 08:32:28 by ABEBE BIKILA via IPS DASHEN BANK. Your balance now is ETB 34720.30. Awash Bank.';
        const plan = buildImportPlan(message(body,'AwashBank'),{ ...context,wallets:[{ ...context.wallets[0],id:'awash',providerId:'awash',accountNumberLast4:'1234' }] });
        expect(plan.candidate?.providerId).toBe('awash'); expect(plan.status).toBe('review');
    });
    it('does not queue personal conversations about payments', () => {
        expect(isFinancialMessage('I paid ETB 100 to Alice yesterday','friend')).toBe(false);
    });
    it('limits exported history and excludes unrelated and out-of-range records', () => {
        const rows = [message(ordinary),{ ...message(ordinary), receivedAt:time-400*86400000 },message('hello'),{ body: ordinary }];
        expect(readExportedMessages(JSON.stringify(rows),time+1000)).toHaveLength(1);
        expect(() => readExportedMessages('{}')).toThrow('array');
        expect(isFinancialMessage('hi')).toBe(false);
    });
    it('runs exactly the shared rules in the generated iOS JavaScriptCore bundle without Node APIs', () => {
        const sandbox: any = {};
        runInNewContext(readFileSync('modules/bankoni-sms/ios/Resources/sms-engine.js','utf8'),sandbox);
        for(const body of [ordinary,cbe,telebirr,'OTP is 123456']) {
            const incoming = message(body,body===telebirr?'telebirr':'CBE');
            expect(JSON.parse(JSON.stringify(sandbox.BanKoniSmsEngine.buildImportPlan(incoming,context))))
                .toEqual(JSON.parse(JSON.stringify(buildImportPlan(incoming,context))));
        }
    });
});
