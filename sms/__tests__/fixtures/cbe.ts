import { defaultCategories } from '../../../constants/defaultCategories';
// Synthetic regression fixtures derived from the existing CBE tests, not bank evidence.
export const cbeCredit = 'Account 1000****1234 has been credited with ETB 12,500.00 on 18/10/2026 at 00:30:24. Balance is ETB 20,000.00. id=FT26107777 Thanks for Banking with CBE.';
export const cbeDebit = 'Dear Customer, A debit transaction of ETB 1300.0 has occurred on your account 1000****1234. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB1312.00. Your current balance is ETB840,060.64. Thanks for Banking with CBE.';
export const cbeTransfer = 'Dear Customer, You have successfully transferred ETB300.00 from account 1000****1234 to account 1000****2222 (ALMAZ AYANA). Service charge of ETB 0.50 and VAT(15%) of ETB0.08 and Disaster Recovery(5%) of 0.03 with total of ETB300.61. Your current balance is ETB5,432.10. Thanks for Banking with CBE. https://apps.cbe.com.et/Receipt/CBE998877';
export const auditNow = Date.parse('2026-11-06T12:00:00+03:00');
export const cbeWallet = { id:'cbe-accuracy',name:'CBE',providerId:'cbe',currency:'ETB',accountNumberLast4:'1234',openingBalance:1000,balance:1000,icon:'wallet',isArchived:false,isDefault:false,createdAt:new Date(auditNow).toISOString() };
export const cbeContext = { wallets:[cbeWallet],categories:defaultCategories,knownAccounts:[],merchants:[],merchantRules:[],educationInstitutions:[] };
export const cbeMessage = (body=cbeCredit) => ({id:'cbe-evidence',body,sender:'CBE',receivedAt:Date.parse('2026-11-04T09:00:00+03:00'),source:'file',walletId:cbeWallet.id,providerId:'cbe'});
