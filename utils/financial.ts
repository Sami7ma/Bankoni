// utils/financial.ts
//
// Pure domain calculations for Financial Intelligence, Analytics, and Budgets.
// 100% decoupled from React Native, SQLite, and Zustand for hermetic testability.

import type { Transaction } from '../types/Transaction';
import type { Category } from '../types/Category';
import type { Budget } from '../types/Budget';
import type { Wallet } from '../types/Wallet';
import type {
    SharedExpenseWithDetails,
    LoanWithDetails,
} from '../types/FinancialRelationships';
import {
    getEthiopianDateString,
    getDaysInclusive,
    getPeriodDateRange,
    AnalyticsPeriod,
    PeriodDateRange,
} from './date';
import { formatEtb } from './format';

export interface PeriodSummary {
    /** Genuine earned income (salary, business, side hustle, interest earned; excludes transfers, refunds, reimbursements, borrowed principal) */
    income: number;
    /** Realized personal spending (net of refunds and reimbursements; excludes transfers, lent principal, principal repayments) */
    expenses: number;
    /** Gross personal spending before refunds and reimbursements */
    grossExpenses: number;
    /** Refunds received in this period reducing purchase costs */
    refunds: number;
    /** Reimbursements received in this period reducing shared expenses */
    reimbursements: number;
    /** Total net wallet movements (inflows minus outflows, excluding internal transfers) */
    netCashFlow: number;
    /** Savings rate percentage based on earned income and realized spending */
    savingsRate: number | null;
    transactionCount: number;

    // Prior period comparison
    priorIncome: number;
    priorExpenses: number;
    priorNetCashFlow: number;
    hasSufficientPriorHistory: boolean;
    expenseChangePercentage: number | null; // e.g. -12.5 means 12.5% reduction
    incomeChangePercentage: number | null;
    netCashFlowDelta: number | null;
}

export interface CategoryBreakdownItem {
    categoryId: string;
    name: string;
    amount: number;
    percentage: string; // e.g. "42.5"
    color: string;
    transactionCount: number;
}

export interface MerchantBreakdownItem {
    merchantId?: string;
    name: string;
    merchantType?: string;
    amount: number;
    percentage: string;
    transactionCount: number;
}

export interface DailySpendingMetrics {
    averageDaily: number;
    activeDays: number;
    totalDays: number;
    hasSufficientData: boolean;
}

export interface ChartDataPoints {
    labels: string[];
    values: number[];
}

export interface BudgetMetrics {
    budgetId: string;
    categoryId: string;
    limitAmount: number;
    spent: number;
    remaining: number;
    percentage: number; // 0 to 100+
    totalDays: number;
    elapsedDays: number;
    daysRemaining: number;
    isBudgetActive: boolean;
    isBudgetEnded: boolean;
    isBudgetFuture: boolean;

    // Pacing and forecasting
    hasSufficientPacingData: boolean;
    dailyPace: number;
    targetDailyAllowance: number;
    projectedTotal: number;
    projectedOverrunAmount: number;

    // Status evaluation
    status: 'ON_TRACK' | 'PACING_OVER' | 'WARNING' | 'EXCEEDED';
    statusMessage: string;
}

export interface ReceivablesAndLiabilitiesSummary {
    totalReceivables: number;
    totalLiabilities: number;
    netPosition: number;
    sharedExpensesReceivable: number;
    lentLoansReceivable: number;
    borrowedLoansPayable: number;
}

export interface ClassificationCoverage {
    totalTransactions: number;
    classifiedTransactions: number;
    unclassifiedTransactions: number;
    coveragePercentage: number;
}

export interface FinancialInsight {
    id: string;
    type: 'cash_flow' | 'comparison' | 'category_driver' | 'daily_pace' | 'budget_alert' | 'receivables' | 'info';
    title: string;
    description: string;
    sentiment: 'positive' | 'negative' | 'neutral' | 'warning';
}

const DEFAULT_CATEGORY_COLORS = [
    '#C9A84C', '#E74C3C', '#2ECC71', '#3498DB',
    '#9B59B6', '#E67E22', '#1ABC9C', '#F39C12',
    '#E91E63', '#00BCD4', '#8BC34A', '#FF5722',
];

// ─────────────────────────────────────────────────────────────
// TRANSACTION CLASSIFICATION GUARDS
// ─────────────────────────────────────────────────────────────

/**
 * Returns true if transaction represents an internal transfer between user's own wallets.
 */
export function isTransferTransaction(tx: Transaction): boolean {
    return Boolean(tx.isTransfer || tx.subType === 'TRANSFER');
}

/**
 * Returns true if transaction represents a refund credit.
 */
export function isRefundTransaction(tx: Transaction): boolean {
    return tx.subType === 'REFUND' || (tx.type === 'CREDIT' && tx.categoryId === 'cat-20');
}

/**
 * Returns true if transaction represents a reimbursement for a shared expense.
 */
export function isReimbursementTransaction(tx: Transaction): boolean {
    return tx.subType === 'REIMBURSEMENT';
}

/**
 * Returns true if transaction represents a loan disbursement (borrowed inflow or lent outflow).
 */
export function isLoanDisbursement(tx: Transaction): boolean {
    return tx.subType === 'LOAN_DISBURSEMENT';
}

/**
 * Returns true if transaction represents a loan principal repayment.
 */
export function isLoanRepayment(tx: Transaction): boolean {
    return tx.subType === 'LOAN_REPAYMENT';
}

/**
 * Returns true if transaction represents genuine earned income.
 * Core rule:
 * - Internal transfers are NOT earned income.
 * - Borrowed principal is NOT earned income.
 * - Refunds are NOT earned income (they reduce purchase cost).
 * - Reimbursements are NOT earned income (they reduce shared expense cost).
 * - Repaid principal from lent money is capital settlement, NOT earned income.
 * - Interest earned IS earned income.
 */
export function isEarnedIncome(tx: Transaction): boolean {
    if (tx.type !== 'CREDIT' || tx.status !== 'CLEARED') return false;
    if (isTransferTransaction(tx)) return false;
    if (isRefundTransaction(tx)) return false;
    if (isReimbursementTransaction(tx)) return false;
    if (isLoanDisbursement(tx)) return false;
    if (isLoanRepayment(tx)) return false;
    return true;
}

/**
 * Returns true if transaction represents personal spending / consumption.
 * Core rule:
 * - Internal transfers are NOT personal spending.
 * - Lent principal is NOT personal spending (capital asset/receivable).
 * - Borrowed principal repayment is capital settlement, NOT personal spending.
 * - Fees and interest paid ARE personal spending / financial costs.
 */
export function isPersonalSpending(tx: Transaction): boolean {
    if (tx.type !== 'DEBIT' || tx.status !== 'CLEARED') return false;
    if (isTransferTransaction(tx)) return false;
    if (isLoanDisbursement(tx)) return false;
    if (isLoanRepayment(tx)) return false;
    return true;
}

// ─────────────────────────────────────────────────────────────
// FILTERING HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Filters transactions to cleared transactions belonging to active ETB wallets.
 */
export function filterEligibleTransactions(
    transactions: Transaction[],
    wallets?: Wallet[]
): Transaction[] {
    const etbWalletIds = wallets
        ? new Set(wallets.filter((w) => (w.currency === 'ETB' || !w.currency) && !w.isArchived).map((w) => w.id))
        : null;

    return transactions.filter((tx) => {
        if (tx.status !== 'CLEARED') return false;
        if (etbWalletIds && !etbWalletIds.has(tx.walletId)) return false;
        return true;
    });
}

/**
 * Filters transactions falling within a specific local Ethiopian date range [startDate, endDate] inclusive.
 */
export function filterTransactionsByDateRange(
    transactions: Transaction[],
    startDate: string,
    endDate: string
): Transaction[] {
    return transactions.filter((tx) => {
        const txLocalDate = getEthiopianDateString(tx.date);
        return txLocalDate >= startDate && txLocalDate <= endDate;
    });
}

/**
 * Finds the earliest transaction local date in a collection, or returns null.
 */
export function getEarliestTransactionDate(transactions: Transaction[]): string | null {
    if (transactions.length === 0) return null;
    let earliest = getEthiopianDateString(transactions[0].date);
    for (let i = 1; i < transactions.length; i++) {
        const d = getEthiopianDateString(transactions[i].date);
        if (d < earliest) earliest = d;
    }
    return earliest;
}

// ─────────────────────────────────────────────────────────────
// PERIOD SUMMARY & METRICS
// ─────────────────────────────────────────────────────────────

/**
 * Calculates earned income, personal spending (net of refunds and reimbursements),
 * net cash flow, and fair prior-period comparisons.
 *
 * FAITHFULNESS GUARANTEE:
 * Does not display misleading prior-period comparisons if the user's transaction
 * history began AFTER the start of the prior period.
 */
export function calculatePeriodSummary(
    transactions: Transaction[],
    dateRange: PeriodDateRange,
    accountCreatedDate?: string
): PeriodSummary {
    const currentTxs = filterTransactionsByDateRange(transactions, dateRange.startDate, dateRange.endDate);
    const priorTxs = filterTransactionsByDateRange(transactions, dateRange.priorStartDate, dateRange.priorEndDate);

    // Current period breakdown
    let income = 0;
    let grossExpenses = 0;
    let refunds = 0;
    let reimbursements = 0;
    let totalInflow = 0;
    let totalOutflow = 0;

    for (const tx of currentTxs) {
        if (isTransferTransaction(tx)) continue;

        // Cash flow: actual wallet movement
        if (tx.type === 'CREDIT') totalInflow += tx.amount;
        if (tx.type === 'DEBIT') totalOutflow += tx.amount;

        // Economic classification
        if (isEarnedIncome(tx)) {
            income += tx.amount;
        } else if (isRefundTransaction(tx)) {
            refunds += tx.amount;
        } else if (isReimbursementTransaction(tx)) {
            reimbursements += tx.amount;
        }

        if (isPersonalSpending(tx)) {
            grossExpenses += tx.amount;
        }
    }

    // Net personal spending after deducting refunds and reimbursements
    const expenses = Math.max(0, Number((grossExpenses - refunds - reimbursements).toFixed(2)));

    // Net cash flow: actual liquidity delta
    const netCashFlow = Number((totalInflow - totalOutflow).toFixed(2));

    // Savings rate: portion of earned income retained after personal expenses
    let savingsRate: number | null = null;
    if (income > 0) {
        savingsRate = Math.round(((income - expenses) / income) * 100);
    }

    // Prior period calculations
    let priorIncome = 0;
    let priorGrossExpenses = 0;
    let priorRefunds = 0;
    let priorReimbursements = 0;
    let priorInflow = 0;
    let priorOutflow = 0;

    for (const tx of priorTxs) {
        if (isTransferTransaction(tx)) continue;

        if (tx.type === 'CREDIT') priorInflow += tx.amount;
        if (tx.type === 'DEBIT') priorOutflow += tx.amount;

        if (isEarnedIncome(tx)) {
            priorIncome += tx.amount;
        } else if (isRefundTransaction(tx)) {
            priorRefunds += tx.amount;
        } else if (isReimbursementTransaction(tx)) {
            priorReimbursements += tx.amount;
        }

        if (isPersonalSpending(tx)) {
            priorGrossExpenses += tx.amount;
        }
    }

    const priorExpenses = Math.max(0, Number((priorGrossExpenses - priorRefunds - priorReimbursements).toFixed(2)));
    const priorNetCashFlow = Number((priorInflow - priorOutflow).toFixed(2));

    // Check if user has sufficient history for a fair prior comparison
    const earliestTx = getEarliestTransactionDate(transactions);
    const historyStart = accountCreatedDate
        ? (earliestTx ? (accountCreatedDate < earliestTx ? accountCreatedDate : earliestTx) : accountCreatedDate)
        : earliestTx;

    const hasSufficientPriorHistory = historyStart != null && historyStart <= dateRange.priorStartDate;

    let expenseChangePercentage: number | null = null;
    let incomeChangePercentage: number | null = null;
    let netCashFlowDelta: number | null = null;

    if (hasSufficientPriorHistory) {
        netCashFlowDelta = Number((netCashFlow - priorNetCashFlow).toFixed(2));
        if (priorExpenses > 0) {
            expenseChangePercentage = Number((((expenses - priorExpenses) / priorExpenses) * 100).toFixed(1));
        }
        if (priorIncome > 0) {
            incomeChangePercentage = Number((((income - priorIncome) / priorIncome) * 100).toFixed(1));
        }
    }

    return {
        income: Number(income.toFixed(2)),
        expenses,
        grossExpenses: Number(grossExpenses.toFixed(2)),
        refunds: Number(refunds.toFixed(2)),
        reimbursements: Number(reimbursements.toFixed(2)),
        netCashFlow,
        savingsRate,
        transactionCount: currentTxs.length,
        priorIncome: Number(priorIncome.toFixed(2)),
        priorExpenses,
        priorNetCashFlow,
        hasSufficientPriorHistory,
        expenseChangePercentage,
        incomeChangePercentage,
        netCashFlowDelta,
    };
}

/**
 * Calculates category breakdown strictly within the given period boundaries.
 * Deducts refunds and reimbursements attributed to each category to report true net spending.
 */
export function calculateCategoryBreakdown(
    transactions: Transaction[],
    categories: Category[],
    startDate: string,
    endDate: string
): CategoryBreakdownItem[] {
    const periodTxs = filterTransactionsByDateRange(transactions, startDate, endDate);
    const categoryMap = new Map<string, Category>(categories.map((c) => [c.id, c]));

    const debitMap: Record<string, { amount: number; count: number }> = {};
    const creditOffsetMap: Record<string, number> = {};
    let totalNetExpenses = 0;

    for (const tx of periodTxs) {
        if (isTransferTransaction(tx)) continue;

        const catId = tx.categoryId || 'unknown';

        if (isPersonalSpending(tx)) {
            if (!debitMap[catId]) debitMap[catId] = { amount: 0, count: 0 };
            debitMap[catId].amount += tx.amount;
            debitMap[catId].count += 1;
        } else if (isRefundTransaction(tx) || isReimbursementTransaction(tx)) {
            creditOffsetMap[catId] = (creditOffsetMap[catId] ?? 0) + tx.amount;
        }
    }

    const items: CategoryBreakdownItem[] = [];
    let colorIndex = 0;

    for (const [catId, data] of Object.entries(debitMap)) {
        const offset = creditOffsetMap[catId] ?? 0;
        const netAmount = Math.max(0, Number((data.amount - offset).toFixed(2)));
        if (netAmount <= 0) continue;

        totalNetExpenses += netAmount;
        const cat = categoryMap.get(catId);
        const name = cat?.name ?? 'Uncategorized';
        const color = cat?.colorKey || DEFAULT_CATEGORY_COLORS[colorIndex % DEFAULT_CATEGORY_COLORS.length];
        colorIndex++;

        items.push({
            categoryId: catId,
            name,
            amount: netAmount,
            percentage: '0', // Will normalize below
            color,
            transactionCount: data.count,
        });
    }

    // Assign normalized percentages
    for (const item of items) {
        item.percentage = totalNetExpenses > 0
            ? ((item.amount / totalNetExpenses) * 100).toFixed(1)
            : '0';
    }

    return items.sort((a, b) => b.amount - a.amount);
}

/**
 * Calculates merchant spending breakdown strictly within the given period boundaries.
 */
export function calculateMerchantBreakdown(
    transactions: Transaction[],
    startDate: string,
    endDate: string,
    sharedExpenses: SharedExpenseWithDetails[] = []
): MerchantBreakdownItem[] {
    const periodTxs = filterTransactionsByDateRange(transactions, startDate, endDate);
    const sharedExpenseMap = new Map<string, SharedExpenseWithDetails>(
        sharedExpenses.map((se) => [se.transactionId, se])
    );
    const merchantMap: Record<string, { name: string; merchantType?: string; amount: number; count: number }> = {};
    let totalMerchantSpending = 0;

    for (const tx of periodTxs) {
        if (!isPersonalSpending(tx)) continue;
        const key = tx.merchantId || tx.counterparty?.trim() || tx.note?.trim() || 'Unspecified';
        const displayName = tx.counterparty?.trim() || tx.note?.trim() || 'Unknown Merchant';

        // Merchant spending uses personal spending rather than the full value of shared bills
        const se = sharedExpenseMap.get(tx.id);
        const personalAmount = se != null ? se.personalShare : tx.amount;

        if (!merchantMap[key]) {
            merchantMap[key] = {
                name: displayName,
                merchantType: undefined,
                amount: 0,
                count: 0,
            };
        }
        merchantMap[key].amount += personalAmount;
        merchantMap[key].count += 1;
        totalMerchantSpending += personalAmount;
    }

    const items: MerchantBreakdownItem[] = Object.entries(merchantMap)
        .map(([id, data]) => ({
            merchantId: id.startsWith('m_') ? id : undefined,
            name: data.name,
            merchantType: data.merchantType,
            amount: Number(data.amount.toFixed(2)),
            percentage: totalMerchantSpending > 0 ? ((data.amount / totalMerchantSpending) * 100).toFixed(1) : '0',
            transactionCount: data.count,
        }))
        .filter((item) => item.amount > 0)
        .sort((a, b) => b.amount - a.amount);

    return items;
}

/**
 * Calculates average daily spending with safeguards against sparse or one-off transactions.
 */
export function calculateDailySpending(
    transactions: Transaction[],
    startDate: string,
    endDate: string,
    accountCreatedDate?: string
): DailySpendingMetrics {
    const periodTxs = filterTransactionsByDateRange(transactions, startDate, endDate);
    let expenses = 0;
    for (const tx of periodTxs) {
        if (isPersonalSpending(tx)) expenses += tx.amount;
        if (isRefundTransaction(tx) || isReimbursementTransaction(tx)) expenses -= tx.amount;
    }
    expenses = Math.max(0, expenses);

    const totalDays = getDaysInclusive(startDate, endDate);
    const earliestTx = getEarliestTransactionDate(periodTxs);

    let activeDays = totalDays;
    if (earliestTx) {
        const daysSinceFirst = getDaysInclusive(earliestTx, endDate);
        activeDays = Math.min(totalDays, daysSinceFirst);
    } else if (accountCreatedDate) {
        const daysSinceCreated = getDaysInclusive(accountCreatedDate, endDate);
        activeDays = Math.min(totalDays, daysSinceCreated);
    }

    const hasSufficientData = activeDays >= 2 && expenses > 0;
    const averageDaily = hasSufficientData ? Number((expenses / activeDays).toFixed(2)) : 0;

    return {
        averageDaily,
        activeDays,
        totalDays,
        hasSufficientData,
    };
}

/**
 * Maps period bucket ranges to line chart data points using identical period boundaries.
 */
export function calculateChartData(
    transactions: Transaction[],
    dateRange: PeriodDateRange
): ChartDataPoints {
    const values: number[] = [];

    for (const bucket of dateRange.bucketRanges) {
        const bucketTxs = filterTransactionsByDateRange(transactions, bucket.startDate, bucket.endDate);
        let bucketExpenses = 0;
        for (const tx of bucketTxs) {
            if (isPersonalSpending(tx)) bucketExpenses += tx.amount;
            if (isRefundTransaction(tx) || isReimbursementTransaction(tx)) bucketExpenses -= tx.amount;
        }
        values.push(Math.max(0, Number(bucketExpenses.toFixed(2))));
    }

    return {
        labels: dateRange.labels,
        values,
    };
}

/**
 * Calculates full operational metrics, run-rate pacing, and warnings for a budget.
 */
export function calculateBudgetMetrics(
    budget: Budget,
    transactions: Transaction[],
    referenceDateInput?: string | Date | number
): BudgetMetrics {
    const todayStr = getEthiopianDateString(referenceDateInput);

    // Eligible transactions within budget period and category
    let grossSpent = 0;
    let credits = 0;

    for (const tx of transactions) {
        if (tx.status !== 'CLEARED' || isTransferTransaction(tx)) continue;
        if (tx.categoryId !== budget.categoryId) continue;
        if (budget.walletId && tx.walletId !== budget.walletId) continue;

        const txLocalDate = getEthiopianDateString(tx.date);
        if (txLocalDate < budget.startDate || txLocalDate > budget.endDate) continue;

        if (isPersonalSpending(tx)) {
            grossSpent += tx.amount;
        } else if (isRefundTransaction(tx) || isReimbursementTransaction(tx)) {
            credits += tx.amount;
        }
    }

    const spent = Math.max(0, Number((grossSpent - credits).toFixed(2)));
    const limitAmount = budget.limitAmount;
    const remaining = Number((limitAmount - spent).toFixed(2));
    const percentage = limitAmount > 0 ? (spent / limitAmount) * 100 : 0;

    const totalDays = Math.max(getDaysInclusive(budget.startDate, budget.endDate), 1);

    const isBudgetFuture = todayStr < budget.startDate;
    const isBudgetEnded = todayStr > budget.endDate;
    const isBudgetActive = !isBudgetFuture && !isBudgetEnded;

    let elapsedDays = 0;
    let daysRemaining = 0;

    if (isBudgetFuture) {
        elapsedDays = 0;
        daysRemaining = totalDays;
    } else if (isBudgetEnded) {
        elapsedDays = totalDays;
        daysRemaining = 0;
    } else {
        elapsedDays = Math.max(getDaysInclusive(budget.startDate, todayStr), 1);
        daysRemaining = Math.max(getDaysInclusive(todayStr, budget.endDate) - 1, 0);
    }

    // Forecasting: pacing projection requires at least 2 elapsed days and an active budget
    const hasSufficientPacingData = isBudgetActive && elapsedDays >= 2 && daysRemaining > 0 && spent > 0;
    const dailyPace = elapsedDays > 0 ? Number((spent / elapsedDays).toFixed(2)) : 0;
    const targetDailyAllowance = daysRemaining > 0 && remaining > 0 ? Number((remaining / daysRemaining).toFixed(2)) : 0;
    const projectedTotal = hasSufficientPacingData ? Number((dailyPace * totalDays).toFixed(2)) : spent;
    const projectedOverrunAmount = projectedTotal > limitAmount ? Number((projectedTotal - limitAmount).toFixed(2)) : 0;

    // Thresholds
    const alertThreshold = budget.alertThreshold ?? 0.8;

    let status: BudgetMetrics['status'] = 'ON_TRACK';
    let statusMessage = 'On track';

    if (spent >= limitAmount) {
        status = 'EXCEEDED';
        statusMessage = `Exceeded by ${formatEtb(spent - limitAmount)}`;
    } else if (percentage >= alertThreshold * 100) {
        status = 'WARNING';
        statusMessage = `${Math.round(percentage)}% of budget spent`;
    } else if (hasSufficientPacingData && projectedOverrunAmount > 0) {
        status = 'PACING_OVER';
        statusMessage = `Pacing high (~${formatEtb(projectedOverrunAmount, { decimals: 0 })} over)`;
    } else if (isBudgetEnded) {
        status = 'ON_TRACK';
        statusMessage = 'Budget period completed';
    } else if (isBudgetFuture) {
        status = 'ON_TRACK';
        statusMessage = `Starts in ${getDaysInclusive(todayStr, budget.startDate)} days`;
    } else {
        status = 'ON_TRACK';
        statusMessage = targetDailyAllowance > 0
            ? `Allowance: ${formatEtb(targetDailyAllowance, { decimals: 0 })}/day`
            : 'On track';
    }

    return {
        budgetId: budget.id,
        categoryId: budget.categoryId,
        limitAmount,
        spent,
        remaining,
        percentage,
        totalDays,
        elapsedDays,
        daysRemaining,
        isBudgetActive,
        isBudgetEnded,
        isBudgetFuture,
        hasSufficientPacingData,
        dailyPace,
        targetDailyAllowance,
        projectedTotal,
        projectedOverrunAmount,
        status,
        statusMessage,
    };
}

/**
 * Calculates outstanding receivables and liabilities from shared expenses and loans.
 */
export function calculateReceivablesAndLiabilities(
    sharedExpenses: SharedExpenseWithDetails[] = [],
    loans: LoanWithDetails[] = []
): ReceivablesAndLiabilitiesSummary {
    let sharedExpensesReceivable = 0;
    for (const se of sharedExpenses) {
        sharedExpensesReceivable += se.outstandingReceivable;
    }

    let lentLoansReceivable = 0;
    let borrowedLoansPayable = 0;

    for (const loan of loans) {
        if (loan.status === 'SETTLED') continue;
        if (loan.type === 'LENT') {
            lentLoansReceivable += loan.remainingPrincipal;
        } else if (loan.type === 'BORROWED') {
            borrowedLoansPayable += loan.remainingPrincipal;
        }
    }

    sharedExpensesReceivable = Number(sharedExpensesReceivable.toFixed(2));
    lentLoansReceivable = Number(lentLoansReceivable.toFixed(2));
    borrowedLoansPayable = Number(borrowedLoansPayable.toFixed(2));

    const totalReceivables = Number((sharedExpensesReceivable + lentLoansReceivable).toFixed(2));
    const totalLiabilities = borrowedLoansPayable;
    const netPosition = Number((totalReceivables - totalLiabilities).toFixed(2));

    return {
        totalReceivables,
        totalLiabilities,
        netPosition,
        sharedExpensesReceivable,
        lentLoansReceivable,
        borrowedLoansPayable,
    };
}

/**
 * Calculates categorization and classification coverage across transactions.
 */
export function calculateClassificationCoverage(
    transactions: Transaction[]
): ClassificationCoverage {
    const total = transactions.length;
    if (total === 0) {
        return {
            totalTransactions: 0,
            classifiedTransactions: 0,
            unclassifiedTransactions: 0,
            coveragePercentage: 100,
        };
    }

    let classified = 0;
    for (const tx of transactions) {
        // A transaction is unclassified if it has no category, or uses the generic 'cat-14' (Misc) without a specific merchant or note
        const isMisc = tx.categoryId === 'cat-14' && !tx.merchantId && !tx.educationInstitutionId;
        if (tx.categoryId && !isMisc) {
            classified++;
        }
    }

    const unclassified = total - classified;
    const coveragePercentage = Number(((classified / total) * 100).toFixed(1));

    return {
        totalTransactions: total,
        classifiedTransactions: classified,
        unclassifiedTransactions: unclassified,
        coveragePercentage,
    };
}

/**
 * Generates explainable, deterministic financial insights backed strictly by real data.
 */
export function generateFinancialInsights(
    summary: PeriodSummary,
    period: AnalyticsPeriod,
    categories: CategoryBreakdownItem[],
    dailySpending: DailySpendingMetrics,
    budgetMetricsList: BudgetMetrics[],
    receivablesSummary?: ReceivablesAndLiabilitiesSummary
): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const periodLabel = period.toLowerCase();

    // 1. Cash flow insight
    if (summary.transactionCount > 0) {
        if (summary.netCashFlow > 0) {
            const savingsRateText = summary.savingsRate !== null ? ` (${summary.savingsRate}% savings rate)` : '';
            insights.push({
                id: 'cf_surplus',
                type: 'cash_flow',
                title: 'Positive Cash Flow',
                description: `You saved ${formatEtb(summary.netCashFlow)} this ${periodLabel}${savingsRateText}.`,
                sentiment: 'positive',
            });
        } else if (summary.netCashFlow < 0) {
            insights.push({
                id: 'cf_deficit',
                type: 'cash_flow',
                title: 'Net Outflow',
                description: `Expenses exceeded income by ${formatEtb(Math.abs(summary.netCashFlow))} this ${periodLabel}.`,
                sentiment: 'warning',
            });
        }
    }

    // 2. Prior period comparison insight (only if verified sufficient history)
    if (summary.hasSufficientPriorHistory && summary.expenseChangePercentage !== null) {
        const change = summary.expenseChangePercentage;
        if (change < -5) {
            insights.push({
                id: 'comp_down',
                type: 'comparison',
                title: 'Spending Decreased',
                description: `Spending is down ${Math.abs(change)}% compared to the prior ${periodLabel}.`,
                sentiment: 'positive',
            });
        } else if (change > 5) {
            insights.push({
                id: 'comp_up',
                type: 'comparison',
                title: 'Spending Increased',
                description: `Spending is up ${change}% compared to the prior ${periodLabel}.`,
                sentiment: 'negative',
            });
        }
    }

    // 3. Top category driver insight
    if (categories.length > 0 && categories[0].amount > 0) {
        const top = categories[0];
        insights.push({
            id: 'top_cat',
            type: 'category_driver',
            title: `Top Category: ${top.name}`,
            description: `${top.name} represents ${top.percentage}% of your expenses this ${periodLabel} (${formatEtb(top.amount, { decimals: 0 })}).`,
            sentiment: 'neutral',
        });
    }

    // 4. Receivables insight (if user has outstanding shared expenses or loans)
    if (receivablesSummary && receivablesSummary.totalReceivables > 0) {
        insights.push({
            id: 'receivables_owed',
            type: 'receivables',
            title: 'Outstanding Receivables',
            description: `You are owed ${formatEtb(receivablesSummary.totalReceivables)} across shared expenses and loans.`,
            sentiment: 'neutral',
        });
    }

    // 5. Daily average spending pace
    if (dailySpending.hasSufficientData) {
        insights.push({
            id: 'daily_pace',
            type: 'daily_pace',
            title: 'Average Daily Spending',
            description: `You are spending an average of ${formatEtb(dailySpending.averageDaily)} per day across ${dailySpending.activeDays} days.`,
            sentiment: 'neutral',
        });
    }

    // 6. Budget warning / pacing alerts
    const pacingBudgets = budgetMetricsList.filter((b) => b.status === 'PACING_OVER' || b.status === 'EXCEEDED' || b.status === 'WARNING');
    if (pacingBudgets.length > 0) {
        const critical = pacingBudgets[0];
        insights.push({
            id: `budget_${critical.budgetId}`,
            type: 'budget_alert',
            title: 'Budget Alert',
            description: `${critical.statusMessage}. Review spending to stay within your target.`,
            sentiment: critical.status === 'EXCEEDED' ? 'negative' : 'warning',
        });
    }

    // Empty state insight if sparse history
    if (insights.length === 0) {
        insights.push({
            id: 'insufficient_history',
            type: 'info',
            title: 'Insights Building Up',
            description: 'Add more transactions to view spending comparisons, daily averages, and budget pacing.',
            sentiment: 'neutral',
        });
    }

    return insights;
}
