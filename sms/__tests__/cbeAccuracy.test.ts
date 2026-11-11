import { describe, expect, it } from '@jest/globals';
import { parseSms, generateSmsFingerprint } from '../index';
import { buildImportPlan } from '../automatic/plan';
import { classifyBillEvidence } from '../billCorrelator';
import { parseMoneyInput } from '../../utils/money';

import { cbeCredit,cbeDebit,cbeTransfer,auditNow,cbeContext,cbeMessage } from './fixtures/cbe';

describe('CBE accuracy regressions',()=>{
    it('strictly parses grouped manual amounts and rejects invalid edits',()=>{
        expect(parseMoneyInput('12,500.00')).toBe(1250000);
        for(const value of ['', '1,23.45','125,50','12.500,00','12abc','1.005','NaN','-1']) expect(parseMoneyInput(value)).toBeNull();
        expect(parseMoneyInput('0')).toBe(0);
    });
    it('does not intercept a CBE transaction because its receipt URL contains receipt',()=>{
        expect(parseSms(cbeTransfer).status).toBe('parsed');
        expect(classifyBillEvidence(cbeTransfer).type).not.toBe('biller_confirmation');
    });
    it.each(['1,23.45','125,50','12.500,00','125.001'])('rejects unsupported CBE monetary notation %s',amount=>{
        expect(parseSms(cbeCredit.replace('12,500.00',amount)).status).not.toBe('parsed');
    });
    it('does not drop malformed, repeated or unknown charge clauses',()=>{
        for(const body of [cbeDebit.replace('ETB 10.00','ETB invalid'),cbeDebit+' Service charge of ETB 10.00.',cbeDebit+' Other fee ETB 3.00.']) expect(parseSms(body).status).not.toBe('parsed');
    });
    it('rejects concatenated CBE movements even with currency attached to digits',()=>{
        expect(parseSms(cbeCredit+' Account 1000****1234 has been credited with ETB300.00.').status).toBe('ambiguous');
    });
    it('never takes a feedback URL identity instead of the established CBE receipt',()=>{
        const result=parseSms('Feedback: https://cbe.et/feedback/?id=SURVEY123 '+cbeTransfer);
        expect(result.status).toBe('parsed');if(result.status==='parsed')expect(result.candidate.reference).toBe('CBE998877');
    });
    it('holds the unverified received-to-account branch instead of claiming template support',()=>{
        // Negative-only reconstruction of the old regex branch, not a bank sample.
        expect(parseSms('You have received ETB 100.00 into your account 1000****1234. Balance is ETB 100.00. Thanks for Banking with CBE.').status).toBe('ambiguous');
    });
    it('requires review for a present unrecognized or impossible CBE date',()=>{
        for(const date of ['INVALID_DATE','31/02/2026 at 08:00:00','2026-11-01T08:38:24+03:00','18/10/2026 at 08:30 PM']) {
            expect(buildImportPlan(cbeMessage(cbeCredit.replace('18/10/2026 at 00:30:24',date)),cbeContext,auditNow).status).toBe('review');
        }
    });
    it('canonicalizes equivalent CBE timestamp fingerprints while preserving other providers',()=>{
        const parsed=parseSms(cbeCredit); expect(parsed.status).toBe('parsed');if(parsed.status!=='parsed')return;
        const c=parsed.candidate;
        expect(generateSmsFingerprint(c)).toBe(generateSmsFingerprint({...c,dateTime:new Date(c.dateTime!).toISOString()}));
    });
    it('leaves the known Awash partial-match regression unchanged for the separate provider repair',()=>{
        const body='Dear Customer, your Account 1000****1234 has been Credited with ETB 125.50 on INVALID_DATE by ABEBE BIKILA. Your balance now is ETB 34720.30. Awash Bank.';
        const parsed=parseSms(body);expect(parsed.status).toBe('parsed');if(parsed.status==='parsed')expect(parsed.candidate.principalAmount).toBe(125);
    });
});
