import {describe,it,expect} from '@jest/globals';
import {parseSms} from '../index';
import {userCbeSamples} from './fixtures/cbeUserSamples';
import {buildImportPlan} from '../automatic/plan';
import {cbeContext,cbeWallet,auditNow} from './fixtures/cbe';
import {authorizeWalletSource} from '../sources';
describe('User-supplied sanitized CBE templates (2026-11-08)',()=>{
  it.each(userCbeSamples)('extracts $direction principal $principal, fees $fees and balance independently',sample=>{
    const result=parseSms(sample.body,'auto','CBE');if(result.status!=='parsed')throw Error(result.reason);
    expect(Math.round(result.candidate.principalAmount*100)).toBe(sample.principal);
    expect(Math.round((result.candidate.fees?.totalFees??0)*100)).toBe(sample.fees);
    expect(Math.round(result.candidate.ledgerAmount*100)).toBe(sample.principal+sample.fees);
    expect(Math.round(result.candidate.currentBalance!*100)).toBe(sample.balance);
    expect(result.candidate).toMatchObject({type:sample.direction,accountLast4:'1111'});
    if('event' in sample)expect(Date.parse(result.candidate.dateTime!)).toBe(Date.parse(sample.event));
    expect(result.candidate.reference).not.toMatch(/forms|feedback|Receipt$/i);
  });
  it('accepts only the selected exact sender and owned CBE account, not a CBE mention',()=>{
    const wallet={...cbeWallet,accountNumberLast4:'1111'};
    const context={...cbeContext,wallets:[wallet],sources:authorizeWalletSource([],wallet,['CBE'],true)};
    const message={id:'user',body:userCbeSamples[2].body,sender:'CBE',receivedAt:auditNow-1000,source:'live',hasTransportIdentity:true,walletId:wallet.id,providerId:'cbe'};
    const plan=buildImportPlan(message,context,auditNow);if(plan.status!=='imported')throw Error(plan.reason);
    for(const sender of ['friend','CBE Birr','CBE-other'])expect(buildImportPlan({...message,sender},context,auditNow).status).not.toBe('imported');
    expect(buildImportPlan(message,{...context,wallets:[{...wallet,accountNumberLast4:'9999'}]},auditNow).status).not.toBe('imported');
  });
});
