// sms/__tests__/financialIntelligenceImport.test.ts
// End-to-end integration tests for Financial Intelligence features:
// - Education Payment Recognition (Feature A)
// - Merchant Recognition & Aliasing (Feature B)
// - Shared Expenses & Reimbursement Integrity (Feature C)
// - Bill Confirmation Correlation vs Duplicate Prevention (Feature D)
// - Telecom Package Service Events vs Financial Debits (Feature E)
// - Centralized Financial Analytics (Feature F)

import { describe, expect, it } from '@jest/globals';
import { recognizeEducationPayment } from '../../utils/educationRecognizer';
import { recognizeMerchant, normalizeMerchantName, detectMerchantType } from '../../utils/merchantRecognizer';
import { classifyBillEvidence, correlateBillConfirmation } from '../billCorrelator';
import { parseTelecomPackageSms } from '../telecomPackage';
import {
    isEarnedIncome,
    calculatePeriodSummary,
    calculateMerchantBreakdown,
    calculateReceivablesAndLiabilities,
} from '../../utils/financial';
import { getPeriodDateRange } from '../../utils/date';
import type { Transaction } from '../../types/Transaction';
import type { SharedExpenseWithDetails } from '../../types/FinancialRelationships';

describe('Financial Intelligence & User-Facing Workflows Integration', () => {
    describe('Feature A: Education Payment Recognition', () => {
        it('recognizes Ethiopian university tuition payment and applies standard defaults', () => {
            const smsText = 'You have transferred ETB 15,000.00 to Addis Ababa University for semester tuition on 22/10/2026.';
            const result = recognizeEducationPayment(smsText, 'Addis Ababa University');

            expect(result.isEducation).toBe(true);
            expect(result.institutionName).toBe('Addis Ababa University');
            expect(result.frequency).toBe('Semester');
            expect(result.feeType).toBe('Tuition');
            expect(result.isRemembered).toBe(false);
        });

        it('recognizes Academy school fee with tuition defaults', () => {
            const smsText = 'Dear Parent, payment of ETB 4,500.00 to Cathedral School has been completed successfully.';
            const result = recognizeEducationPayment(smsText, 'Cathedral School');

            expect(result.isEducation).toBe(true);
            expect(result.institutionName).toBe('Cathedral School');
            expect(result.frequency).toBe('Semester');
            expect(result.feeType).toBe('Tuition');
        });

        it('reuses remembered local institution on exact or normalized match', () => {
            const remembered = [
                {
                    id: 'edu-1',
                    name: "St. Joseph's School",
                    normalizedName: 'st josephs school',
                    preferredFrequency: 'Semester' as const,
                    preferredFeeType: 'Tuition' as const,
                    createdAt: '2026-01-01',
                },
            ];

            const smsText = 'Transferred ETB 8,000 to St Joseph School for tuition.';
            const result = recognizeEducationPayment(smsText, "St. Joseph's School", remembered);

            expect(result.isEducation).toBe(true);
            expect(result.matchedInstitution?.id).toBe('edu-1');
            expect(result.frequency).toBe('Semester');
            expect(result.isRemembered).toBe(true);
        });
    });

    describe('Feature B: Merchant Recognition & Normalization', () => {
        it('strips prefixes and legal suffixes and normalizes merchant name', () => {
            const normalized = normalizeMerchantName("To Kaldi's Coffee Bole Branch");
            expect(normalized).toBe('kaldi s coffee');

            const recognized = recognizeMerchant("Kaldi's Cafe");
            expect(recognized.isMerchant).toBe(true);
            expect(recognized.merchantType).toBe('coffee_shop');
        });

        it('recognizes grocery supermarket merchants', () => {
            const recognized = recognizeMerchant('Shoa Supermarket');
            expect(recognized.isMerchant).toBe(true);
            expect(recognized.merchantType).toBe('groceries');
        });

        it('detects domain categories accurately with detectMerchantType', () => {
            expect(detectMerchantType('Tomoca Coffee')).toBe('coffee_shop');
            expect(detectMerchantType('Mulmul Bakery')).toBe('bakery');
            expect(detectMerchantType('Castelli Restaurant')).toBe('restaurant');
            expect(detectMerchantType('Novis Minimarket')).toBe('groceries');
        });
    });

    describe('Feature D: Bill Payment & Confirmation Correlation', () => {
        it('correlates biller confirmation with wallet debit and prevents duplicate expense', () => {
            // Existing debit transaction from Telebirr wallet
            const mockDebit: Transaction = {
                id: 'tx-debit-telebirr-1',
                amount: 1874.99,
                type: 'DEBIT',
                subType: 'STANDARD',
                categoryId: 'cat-11',
                walletId: 'w-telebirr',
                counterparty: 'Ethio telecom',
                date: '2026-10-21T10:15:00Z',
                note: 'Ethio telecom bill payment account 0115512345',
                status: 'CLEARED',
                createdAt: '2026-10-21T10:15:00Z',
            };

            // Subsequent receipt confirmation SMS from Ethio Telecom biller
            const billerSms =
                'Dear customer, your payment of ETB 1,874.99 for service number 0115512345 has been received on 25/10/2026 14:30:15. Receipt no: REC-998811. Thank you for choosing Ethio telecom.';

            const classified = classifyBillEvidence(billerSms);
            expect(classified.type).toBe('biller_confirmation');
            expect(classified.evidence).toBeDefined();

            if (classified.evidence) {
                const correlation = correlateBillConfirmation(classified.evidence, [mockDebit]);
                expect(correlation.status).toBe('MATCHED');
                expect(correlation.matchedTransactionId).toBe('tx-debit-telebirr-1');
            }
        });
    });

    describe('Feature E: Telecom Package Intelligence', () => {
        it('classifies service events without generating phantom zero-value debits', () => {
            const alert75Sms = 'Daily Internet Package 360 MB used 75%, with expiry 25/10/2026 23:59:59.';
            const resAlert = parseTelecomPackageSms(alert75Sms);

            expect(resAlert.isTelecomPackage).toBe(true);
            expect(resAlert.isFinancialDebit).toBe(false);
            expect(resAlert.eventType).toBe('USAGE_ALERT');
            expect(resAlert.price).toBeUndefined();

            const depletionSms = 'Daily Internet Package 360 MB finished.';
            const resDepletion = parseTelecomPackageSms(depletionSms);
            expect(resDepletion.eventType).toBe('DEPLETION');
            expect(resDepletion.isFinancialDebit).toBe(false);

            const activationSms = 'Two-hour unlimited internet offer activated on 25/10/2026 10:00:00, valid until 25/10/2026 12:00:00.';
            const resActivation = parseTelecomPackageSms(activationSms);
            expect(resActivation.eventType).toBe('ACTIVATION');
            expect(resActivation.isFinancialDebit).toBe(false);
        });

        it('correctly flags genuine package purchase as financial debit with price', () => {
            const purchaseSms = 'Telebirr ETB 45 Monthly SMS Package 960 SMS purchase.';
            const resPurchase = parseTelecomPackageSms(purchaseSms);

            expect(resPurchase.isTelecomPackage).toBe(true);
            expect(resPurchase.isFinancialDebit).toBe(true);
            expect(resPurchase.eventType).toBe('PURCHASE');
            expect(resPurchase.price).toBe(45);
        });
    });

    describe('Feature C & F: Split Expenses, Reimbursement & Financial Integrity', () => {
        it('calculates realized out-of-pocket spending and ignores reimbursements from earned income', () => {
            // User pays 1,200 ETB for group dinner
            const groupDinnerTx: Transaction = {
                id: 'tx-dinner-1',
                amount: 1200,
                type: 'DEBIT',
                subType: 'SHARED_EXPENSE',
                categoryId: 'cat-2',
                walletId: 'w-cbe',
                date: '2026-10-15T19:00:00Z',
                note: 'Dinner at 2000 Habesha',
                status: 'CLEARED',
                createdAt: '2026-10-15T19:00:00Z',
            };

            // Shared expense details: Personal share = 400 ETB, Dawit owes 400 ETB, Bethlehem owes 400 ETB
            const sharedExpense: SharedExpenseWithDetails = {
                id: 'se-1',
                transactionId: 'tx-dinner-1',
                totalAmount: 1200,
                personalShare: 400,
                description: 'Group dinner',
                createdAt: '2026-10-15T19:00:00Z',
                participants: [
                    { id: 'p-dawit', sharedExpenseId: 'se-1', name: 'Dawit', expectedAmount: 400, paidAmount: 400, createdAt: '2026-10-15' },
                    { id: 'p-beth', sharedExpenseId: 'se-1', name: 'Bethlehem', expectedAmount: 400, paidAmount: 0, createdAt: '2026-10-15' },
                ],
                reimbursements: [
                    { id: 'r-1', sharedExpenseId: 'se-1', reimbursementTransactionId: 'tx-reimb-1', participantId: 'p-dawit', allocatedAmount: 400, createdAt: '2026-10-16' },
                ],
                totalReimbursed: 400,
                outstandingReceivable: 400,
                realizedPersonalCost: 800, // 1200 - 400 reimbursed so far
            };

            // Dawit reimburses 400 ETB via Telebirr
            const reimbursementTx: Transaction = {
                id: 'tx-reimb-1',
                amount: 400,
                type: 'CREDIT',
                subType: 'REIMBURSEMENT',
                categoryId: 'cat-2',
                walletId: 'w-telebirr',
                date: '2026-10-16T12:00:00Z',
                note: 'Dawit dinner split repayment',
                status: 'CLEARED',
                createdAt: '2026-10-16T12:00:00Z',
            };

            // Salary transaction
            const salaryTx: Transaction = {
                id: 'tx-salary-1',
                amount: 25000,
                type: 'CREDIT',
                subType: 'STANDARD',
                categoryId: 'cat-1',
                walletId: 'w-cbe',
                date: '2026-10-01T08:00:00Z',
                note: 'October Salary',
                status: 'CLEARED',
                createdAt: '2026-10-01T08:00:00Z',
            };

            // 1. Verify Reimbursement is NOT counted as earned income
            expect(isEarnedIncome(reimbursementTx)).toBe(false);
            expect(isEarnedIncome(salaryTx)).toBe(true);

            // 2. Verify Period Summary
            const transactions = [salaryTx, groupDinnerTx, reimbursementTx];
            const dateRange = getPeriodDateRange('Month', '2026-10-20');
            const summary = calculatePeriodSummary(transactions, dateRange);

            expect(summary.income).toBe(25000); // Only salary, not 25,400!
            expect(summary.grossExpenses).toBe(1200);
            expect(summary.reimbursements).toBe(400);
            expect(summary.expenses).toBe(800); // 1200 - 400 reimbursement deduction
            expect(summary.netCashFlow).toBe(24200); // 25000 - 800

            // 3. Verify Receivables and Liabilities calculation
            const rec = calculateReceivablesAndLiabilities([sharedExpense], []);
            expect(rec.sharedExpensesReceivable).toBe(400); // Bethlehem still owes 400
            expect(rec.totalReceivables).toBe(400);
            expect(rec.totalLiabilities).toBe(0);
        });

        it('aggregates merchant breakdown correctly across eligible transactions', () => {
            const txList: Transaction[] = [
                {
                    id: 'tx-1',
                    amount: 250,
                    type: 'DEBIT',
                    categoryId: 'cat-2',
                    walletId: 'w-1',
                    counterparty: "Kaldi's Coffee",
                    date: '2026-10-10T10:00:00Z',
                    status: 'CLEARED',
                    createdAt: '2026-10-10T10:00:00Z',
                },
                {
                    id: 'tx-2',
                    amount: 350,
                    type: 'DEBIT',
                    categoryId: 'cat-2',
                    walletId: 'w-1',
                    counterparty: "Kaldi's Coffee",
                    date: '2026-10-12T10:00:00Z',
                    status: 'CLEARED',
                    createdAt: '2026-10-12T10:00:00Z',
                },
                {
                    id: 'tx-3',
                    amount: 1400,
                    type: 'DEBIT',
                    categoryId: 'cat-3',
                    walletId: 'w-1',
                    counterparty: 'Shoa Supermarket',
                    date: '2026-10-14T15:00:00Z',
                    status: 'CLEARED',
                    createdAt: '2026-10-14T15:00:00Z',
                },
            ];

            const breakdown = calculateMerchantBreakdown(txList, '2026-10-01', '2026-10-31');
            expect(breakdown).toHaveLength(2);
            expect(breakdown[0].name).toBe('Shoa Supermarket');
            expect(breakdown[0].amount).toBe(1400);
            expect(breakdown[1].name).toBe("Kaldi's Coffee");
            expect(breakdown[1].amount).toBe(600);
            expect(breakdown[1].transactionCount).toBe(2);
        });
    });
});
