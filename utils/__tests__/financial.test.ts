// utils/__tests__/financial.test.ts

import { describe, expect, it } from '@jest/globals';
import type { Transaction } from '../../types/Transaction';
import type { Category } from '../../types/Category';
import type { Budget } from '../../types/Budget';
import type { Wallet } from '../../types/Wallet';
import { getPeriodDateRange } from '../date';
import {
    calculatePeriodSummary,
    calculateCategoryBreakdown,
    calculateDailySpending,
    calculateChartData,
    calculateBudgetMetrics,
    generateFinancialInsights,
    filterEligibleTransactions,
} from '../financial';

describe('Financial Intelligence Calculations Engine', () => {
    const mockCategories: Category[] = [
        { id: 'cat-groceries', name: 'Groceries', iconKey: 'shopping_cart', flow: 'EXPENSE', essential: true, recurring: true, isBuiltIn: true, isCustom: false },
        { id: 'cat-transport', name: 'Transport', iconKey: 'car', flow: 'EXPENSE', essential: true, recurring: true, isBuiltIn: true, isCustom: false },
        { id: 'cat-salary', name: 'Salary', iconKey: 'banknote', flow: 'INCOME', essential: true, recurring: true, isBuiltIn: true, isCustom: false },
    ];

    const mockWallets: Wallet[] = [
        { id: 'w-cbe', name: 'CBE', icon: 'building_2', providerId: 'cbe', balance: 50000, openingBalance: 50000, currency: 'ETB', isDefault: true, isArchived: false, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'w-archived', name: 'Old Account', icon: 'building_2', providerId: 'cbe', balance: 100, openingBalance: 100, currency: 'ETB', isDefault: false, isArchived: true, createdAt: '2026-01-01T00:00:00Z' },
    ];

    const refDate = '2026-10-29'; // Reference today
    const weekRange = getPeriodDateRange('Week', refDate); // 2026-10-23 to 2026-10-29, prior: 2026-10-16 to 2026-10-22

    describe('filterEligibleTransactions', () => {
        it('excludes PENDING transactions and archived wallet transactions', () => {
            const txs: Transaction[] = [
                { id: '1', amount: 500, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-25T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: '2', amount: 300, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-25T10:00:00+03:00', status: 'PENDING', walletId: 'w-cbe', createdAt: '' },
                { id: '3', amount: 200, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-25T10:00:00+03:00', status: 'CLEARED', walletId: 'w-archived', createdAt: '' },
            ];

            const eligible = filterEligibleTransactions(txs, mockWallets);
            expect(eligible.length).toBe(1);
            expect(eligible[0].id).toBe('1');
        });
    });

    describe('Period Summary & Net Cash Flow', () => {
        it('calculates income, expenses, and net cash flow strictly within period boundaries', () => {
            const txs: Transaction[] = [
                // In current week: Oct 23 to Oct 29
                { id: 't1', amount: 10000, type: 'CREDIT', categoryId: 'cat-salary', date: '2026-10-24T09:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: 't2', amount: 2500, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-25T12:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: 't3', amount: 500, type: 'DEBIT', categoryId: 'cat-transport', date: '2026-10-29T01:30:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' }, // Early morning Oct 29

                // In prior week: Oct 16 to Oct 22
                { id: 't4', amount: 8000, type: 'CREDIT', categoryId: 'cat-salary', date: '2026-10-18T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: 't5', amount: 2000, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-20T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },

                // Outside both periods: Oct 10
                { id: 't6', amount: 9999, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-10T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            // Account created before prior week
            const summary = calculatePeriodSummary(txs, weekRange, '2026-09-01');

            expect(summary.income).toBe(10000);
            expect(summary.expenses).toBe(3000); // 2500 + 500
            expect(summary.netCashFlow).toBe(7000); // 10000 - 3000
            expect(summary.transactionCount).toBe(3);

            // Prior period
            expect(summary.priorIncome).toBe(8000);
            expect(summary.priorExpenses).toBe(2000);
            expect(summary.priorNetCashFlow).toBe(6000);

            // Comparison
            expect(summary.hasSufficientPriorHistory).toBe(true);
            expect(summary.expenseChangePercentage).toBe(50); // ((3000 - 2000) / 2000) * 100 = +50%
            expect(summary.incomeChangePercentage).toBe(25);  // ((10000 - 8000) / 8000) * 100 = +25%
            expect(summary.netCashFlowDelta).toBe(1000);      // 7000 - 6000
        });

        it('does not invent prior period comparisons when user history is insufficient', () => {
            const txs: Transaction[] = [
                // User started 2 days ago (Oct 27)
                { id: 't1', amount: 1500, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-27T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            // Account created on Oct 27, which is AFTER priorStartDate (Oct 16)
            const summary = calculatePeriodSummary(txs, weekRange, '2026-10-27');

            expect(summary.expenses).toBe(1500);
            expect(summary.priorExpenses).toBe(0);
            // Must NOT claim -100% or +∞%
            expect(summary.hasSufficientPriorHistory).toBe(false);
            expect(summary.expenseChangePercentage).toBeNull();
            expect(summary.netCashFlowDelta).toBeNull();
        });

        it('handles zero transactions gracefully', () => {
            const summary = calculatePeriodSummary([], weekRange);
            expect(summary.income).toBe(0);
            expect(summary.expenses).toBe(0);
            expect(summary.netCashFlow).toBe(0);
            expect(summary.transactionCount).toBe(0);
            expect(summary.hasSufficientPriorHistory).toBe(false);
            expect(summary.expenseChangePercentage).toBeNull();
        });
    });

    describe('Category Spending Breakdown', () => {
        it('groups by category strictly within the period and sorts descending', () => {
            const txs: Transaction[] = [
                { id: 't1', amount: 700, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-25T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: 't2', amount: 300, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-26T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: 't3', amount: 500, type: 'DEBIT', categoryId: 'cat-transport', date: '2026-10-27T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                // Ignored (income)
                { id: 't4', amount: 5000, type: 'CREDIT', categoryId: 'cat-salary', date: '2026-10-27T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                // Ignored (outside period)
                { id: 't5', amount: 2000, type: 'DEBIT', categoryId: 'cat-transport', date: '2026-10-10T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            const breakdown = calculateCategoryBreakdown(txs, mockCategories, weekRange.startDate, weekRange.endDate);

            expect(breakdown.length).toBe(2);
            // Groceries = 1000 (66.7%), Transport = 500 (33.3%)
            expect(breakdown[0].categoryId).toBe('cat-groceries');
            expect(breakdown[0].amount).toBe(1000);
            expect(breakdown[0].percentage).toBe('66.7');
            expect(breakdown[0].transactionCount).toBe(2);

            expect(breakdown[1].categoryId).toBe('cat-transport');
            expect(breakdown[1].amount).toBe(500);
            expect(breakdown[1].percentage).toBe('33.3');
            expect(breakdown[1].transactionCount).toBe(1);
        });
    });

    describe('Average Daily Spending', () => {
        it('computes daily average when there are at least 2 active days', () => {
            const txs: Transaction[] = [
                { id: 't1', amount: 400, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-25T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: 't2', amount: 600, type: 'DEBIT', categoryId: 'cat-transport', date: '2026-10-29T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            // Between Oct 25 and Oct 29 is 5 active calendar days
            const daily = calculateDailySpending(txs, weekRange.startDate, weekRange.endDate);
            expect(daily.hasSufficientData).toBe(true);
            expect(daily.activeDays).toBe(5);
            expect(daily.averageDaily).toBe(200); // 1000 ETB / 5 days = 200 ETB/day
        });

        it('safeguards against single-transaction distortion on Day 1', () => {
            const txs: Transaction[] = [
                // Only 1 transaction on reference date (activeDays = 1)
                { id: 't1', amount: 1500, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-29T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            const daily = calculateDailySpending(txs, weekRange.startDate, weekRange.endDate);
            expect(daily.activeDays).toBe(1);
            expect(daily.hasSufficientData).toBe(false);
            expect(daily.averageDaily).toBe(0);
        });
    });

    describe('Chart Data Slicing', () => {
        it('accurately sums expenses into daily buckets for the week chart', () => {
            const txs: Transaction[] = [
                { id: 't1', amount: 250, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-29T02:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: 't2', amount: 350, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-29T14:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: 't3', amount: 100, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-28T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            const chart = calculateChartData(txs, weekRange);
            expect(chart.labels.length).toBe(7);
            expect(chart.values.length).toBe(7);

            // Last bucket is today (Oct 29): 250 + 350 = 600
            expect(chart.values[6]).toBe(600);
            // Second to last is yesterday (Oct 28): 100
            expect(chart.values[5]).toBe(100);
            // Other days: 0
            expect(chart.values[0]).toBe(0);
        });
    });

    describe('Budget Calculations & Forecasting', () => {
        const activeBudget: Budget = {
            id: 'b-oct',
            categoryId: 'cat-groceries',
            limitAmount: 5000,
            startDate: '2026-10-01',
            endDate: '2026-10-31',
            recurring: 'monthly',
            alertThreshold: 0.8,
        };

        it('evaluates normal on-track spending with target daily allowance', () => {
            const txs: Transaction[] = [
                // Day 10 of month: spent 1000 out of 5000
                { id: 't1', amount: 1000, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-10T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            const metrics = calculateBudgetMetrics(activeBudget, txs, '2026-10-10');
            expect(metrics.spent).toBe(1000);
            expect(metrics.remaining).toBe(4000);
            expect(metrics.percentage).toBe(20);
            expect(metrics.elapsedDays).toBe(10);
            expect(metrics.daysRemaining).toBe(21);
            expect(metrics.hasSufficientPacingData).toBe(true);

            // Daily pace = 1000 / 10 = 100/day. Projected total = 100 * 31 = 3100 <= 5000 (ON_TRACK)
            expect(metrics.dailyPace).toBe(100);
            expect(metrics.projectedTotal).toBe(3100);
            expect(metrics.projectedOverrunAmount).toBe(0);
            expect(metrics.status).toBe('ON_TRACK');
        });

        it('detects pace overruns when spending rate will blow budget by end of month', () => {
            const txs: Transaction[] = [
                // On Day 10: spent 3000 out of 5000 (pace is 300/day -> projected 9300)
                { id: 't1', amount: 3000, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-10T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            const metrics = calculateBudgetMetrics(activeBudget, txs, '2026-10-10');
            expect(metrics.spent).toBe(3000);
            expect(metrics.dailyPace).toBe(300);
            expect(metrics.projectedTotal).toBe(9300);
            expect(metrics.projectedOverrunAmount).toBe(4300); // 9300 - 5000
            expect(metrics.status).toBe('PACING_OVER');
            expect(metrics.statusMessage).toContain('Pacing high');
        });

        it('flags WARNING status when alert threshold (80%) is crossed', () => {
            const txs: Transaction[] = [
                { id: 't1', amount: 4200, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-28T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            const metrics = calculateBudgetMetrics(activeBudget, txs, '2026-10-28');
            expect(metrics.percentage).toBe(84); // >= 80%
            expect(metrics.status).toBe('WARNING');
        });

        it('flags EXCEEDED status when spent exceeds 100% of limit', () => {
            const txs: Transaction[] = [
                { id: 't1', amount: 5500, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-20T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            const metrics = calculateBudgetMetrics(activeBudget, txs, '2026-10-20');
            expect(metrics.spent).toBe(5500);
            expect(metrics.remaining).toBe(-500);
            expect(metrics.status).toBe('EXCEEDED');
            expect(metrics.statusMessage).toContain('Exceeded by ETB 500.00');
        });

        it('does not project pacing overruns on Day 1 (insufficient pacing data)', () => {
            const txs: Transaction[] = [
                // Day 1 purchase: spent 400
                { id: 't1', amount: 400, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-01T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            const metrics = calculateBudgetMetrics(activeBudget, txs, '2026-10-01');
            expect(metrics.elapsedDays).toBe(1);
            expect(metrics.hasSufficientPacingData).toBe(false);
            expect(metrics.status).toBe('ON_TRACK'); // Not PACING_OVER
        });

        it('handles ended and future budgets correctly', () => {
            // Future budget
            const futureBudget: Budget = {
                ...activeBudget,
                startDate: '2026-11-01',
                endDate: '2026-11-30',
            };
            const futureMetrics = calculateBudgetMetrics(futureBudget, [], '2026-10-29');
            expect(futureMetrics.isBudgetFuture).toBe(true);
            expect(futureMetrics.statusMessage).toContain('Starts in');

            // Ended budget
            const endedBudget: Budget = {
                ...activeBudget,
                startDate: '2026-09-01',
                endDate: '2026-09-30',
            };
            const endedMetrics = calculateBudgetMetrics(endedBudget, [], '2026-10-29');
            expect(endedMetrics.isBudgetEnded).toBe(true);
            expect(endedMetrics.daysRemaining).toBe(0);
        });
    });

    describe('generateFinancialInsights', () => {
        it('generates positive cash flow and top category driver insights', () => {
            const summary = {
                income: 15000,
                expenses: 5000,
                netCashFlow: 10000,
                transactionCount: 8,
                priorIncome: 12000,
                priorExpenses: 6000,
                priorNetCashFlow: 6000,
                hasSufficientPriorHistory: true,
                expenseChangePercentage: -16.7,
                incomeChangePercentage: 25,
                netCashFlowDelta: 4000,
            };

            const categories = [
                { categoryId: 'cat-groceries', name: 'Groceries', amount: 3000, percentage: '60.0', color: '#FFF', transactionCount: 4 },
            ];

            const daily = {
                averageDaily: 250,
                activeDays: 20,
                totalDays: 28,
                hasSufficientData: true,
            };

            const insights = generateFinancialInsights(summary, 'Month', categories, daily, []);
            expect(insights.length).toBeGreaterThanOrEqual(3);

            const cf = insights.find((i) => i.type === 'cash_flow');
            expect(cf?.title).toBe('Positive Cash Flow');
            expect(cf?.sentiment).toBe('positive');

            const comp = insights.find((i) => i.type === 'comparison');
            expect(comp?.title).toBe('Spending Decreased');

            const top = insights.find((i) => i.type === 'category_driver');
            expect(top?.title).toContain('Groceries');
        });
    });

    describe('Internal Transfers & Reimbursements Classification', () => {
        it('excludes verified internal transfers from economic income and expenses', () => {
            const txs: Transaction[] = [
                // Real economic income: salary +5000
                { id: 'tx-1', amount: 5000, type: 'CREDIT', categoryId: 'cat-salary', date: '2026-10-25T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '2026-10-25T10:00:00Z' },
                // Real economic expense: groceries -1000
                { id: 'tx-2', amount: 1000, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-26T14:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '2026-10-26T14:00:00Z' },
                // Internal transfer: CBE to Telebirr 2000 (debit on CBE, credit on Telebirr)
                { id: 'tx-3', amount: 2000, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-27T11:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', isTransfer: true, transferWalletId: 'w-telebirr', createdAt: '2026-10-27T11:00:00Z' },
                { id: 'tx-4', amount: 2000, type: 'CREDIT', categoryId: 'cat-salary', date: '2026-10-27T11:00:00+03:00', status: 'CLEARED', walletId: 'w-telebirr', isTransfer: true, transferWalletId: 'w-cbe', createdAt: '2026-10-27T11:00:00Z' },
            ];

            const summary = calculatePeriodSummary(txs, weekRange);

            // Gross income should be 5000, NOT 7000
            expect(summary.income).toBe(5000);
            // Gross expenses should be 1000, NOT 3000
            expect(summary.expenses).toBe(1000);
            // Net cash flow should be 4000
            expect(summary.netCashFlow).toBe(4000);

            // Category breakdown should only report the real 1000 expense
            const breakdown = calculateCategoryBreakdown(txs, mockCategories, weekRange.startDate, weekRange.endDate);
            expect(breakdown.find((b) => b.categoryId === 'cat-groceries')?.amount).toBe(1000);

            // Budget metrics should not count the transfer as budget consumption
            const budget: Budget = {
                id: 'b-1',
                categoryId: 'cat-groceries',
                limitAmount: 1500,
                startDate: '2026-10-23',
                endDate: '2026-10-29',
                walletId: 'w-cbe',
            };
            const bMetrics = calculateBudgetMetrics(budget, txs, refDate);
            expect(bMetrics.spent).toBe(1000);
            expect(bMetrics.remaining).toBe(500);
            expect(bMetrics.status).toBe('ON_TRACK');
        });

        it('treats reimbursement as chronological cash flow without erasing historical expense', () => {
            const txs: Transaction[] = [
                // Oct 24: Initial out-of-pocket expense for transport (-1200)
                { id: 'tx-exp', amount: 1200, type: 'DEBIT', categoryId: 'cat-transport', date: '2026-10-24T09:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '2026-10-24T09:00:00Z' },
                // Oct 27: Employer reimbursement arrives (+1200)
                { id: 'tx-reimb', amount: 1200, type: 'CREDIT', categoryId: 'cat-refund', date: '2026-10-27T16:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '2026-10-27T16:00:00Z' },
            ];

            const summary = calculatePeriodSummary(txs, weekRange);
            // Both transactions are real economic events:
            expect(summary.expenses).toBe(1200);
            expect(summary.income).toBe(1200);
            // The net cash flow reflects the offset (+1200 - 1200 = 0)
            expect(summary.netCashFlow).toBe(0);

            // Category breakdown preserves the 1200 transport expense for visibility into actual spend
            const breakdown = calculateCategoryBreakdown(txs, mockCategories, weekRange.startDate, weekRange.endDate);
            expect(breakdown.find((b) => b.categoryId === 'cat-transport')?.amount).toBe(1200);
        });
    });

    describe('Floating Point Precision & Santim Rounding', () => {
        it('prevents IEEE-754 precision artifacts in period summaries and budget calculations', () => {
            const txs: Transaction[] = [
                { id: 'p1', amount: 10.10, type: 'CREDIT', categoryId: 'cat-salary', date: '2026-10-25T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: 'p2', amount: 20.20, type: 'CREDIT', categoryId: 'cat-salary', date: '2026-10-26T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: 'p3', amount: 10.10, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-27T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
                { id: 'p4', amount: 20.20, type: 'DEBIT', categoryId: 'cat-groceries', date: '2026-10-28T10:00:00+03:00', status: 'CLEARED', walletId: 'w-cbe', createdAt: '' },
            ];

            const summary = calculatePeriodSummary(txs, weekRange);
            // 10.10 + 20.20 in raw IEEE-754 is 30.300000000000004
            expect(summary.income).toBe(30.30);
            expect(summary.expenses).toBe(30.30);
            expect(summary.netCashFlow).toBe(0);

            const budget: Budget = {
                id: 'b-precision',
                categoryId: 'cat-groceries',
                limitAmount: 100,
                startDate: '2026-10-23',
                endDate: '2026-10-29',
                walletId: 'w-cbe',
            };
            const bMetrics = calculateBudgetMetrics(budget, txs, refDate);
            expect(bMetrics.spent).toBe(30.30);
            expect(bMetrics.remaining).toBe(69.70);
        });
    });
});


