// utils/financial.ts
//
// Pure domain calculations for Financial Intelligence, Analytics, and Budgets.
// 100% decoupled from React Native, SQLite, and Zustand for hermetic testability.

import type { Transaction } from '../types/Transaction';
import type { Category } from '../types/Category';
import type { Budget } from '../types/Budget';
import type { Wallet } from '../types/Wallet';
import {
    getEthiopianDateString,
    getDaysInclusive,
    getPeriodDateRange,
    AnalyticsPeriod,
    PeriodDateRange,
} from './date';
import { formatEtb } from './format';

export interface PeriodSummary {
    income: number;
    expenses: number;
    netCashFlow: number;
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

export interface FinancialInsight {
    id: string;
    type: 'cash_flow' | 'comparison' | 'category_driver' | 'daily_pace' | 'budget_alert' | 'info';
    title: string;
    description: string;
    sentiment: 'positive' | 'negative' | 'neutral' | 'warning';
}

const DEFAULT_CATEGORY_COLORS = [
    '#C9A84C', '#E74C3C', '#2ECC71', '#3498DB',
    '#9B59B6', '#E67E22', '#1ABC9C', '#F39C12',
    '#E91E63', '#00BCD4', '#8BC34A', '#FF5722',
];

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

/**
 * Calculates income, expenses, net cash flow, and fair prior-period comparisons.
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

    let income = 0;
    let expenses = 0;
    for (const tx of currentTxs) {
        if (tx.isTransfer) continue;
        if (tx.type === 'CREDIT') income += tx.amount;
        if (tx.type === 'DEBIT') expenses += tx.amount;
    }

    let priorIncome = 0;
    let priorExpenses = 0;
    for (const tx of priorTxs) {
        if (tx.isTransfer) continue;
        if (tx.type === 'CREDIT') priorIncome += tx.amount;
        if (tx.type === 'DEBIT') priorExpenses += tx.amount;
    }

    income = Number(income.toFixed(2));
    expenses = Number(expenses.toFixed(2));
    priorIncome = Number(priorIncome.toFixed(2));
    priorExpenses = Number(priorExpenses.toFixed(2));

    const netCashFlow = Number((income - expenses).toFixed(2));
    const priorNetCashFlow = Number((priorIncome - priorExpenses).toFixed(2));

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
        income,
        expenses,
        netCashFlow,
        transactionCount: currentTxs.length,
        priorIncome,
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
 */
export function calculateCategoryBreakdown(
    transactions: Transaction[],
    categories: Category[],
    startDate: string,
    endDate: string
): CategoryBreakdownItem[] {
    const periodTxs = filterTransactionsByDateRange(transactions, startDate, endDate);
    const debitTxs = periodTxs.filter((tx) => tx.type === 'DEBIT' && !tx.isTransfer);

    const grouped: Record<string, { amount: number; count: number }> = {};
    let totalExpenses = 0;

    for (const tx of debitTxs) {
        const catId = tx.categoryId || 'unknown';
        if (!grouped[catId]) {
            grouped[catId] = { amount: 0, count: 0 };
        }
        grouped[catId].amount += tx.amount;
        grouped[catId].count += 1;
        totalExpenses += tx.amount;
    }

    const categoryMap = new Map<string, Category>(categories.map((c) => [c.id, c]));

    const items: CategoryBreakdownItem[] = Object.entries(grouped)
        .map(([categoryId, data], index) => {
            const cat = categoryMap.get(categoryId);
            const name = cat?.name ?? 'Uncategorized';
            const color = cat?.colorKey || DEFAULT_CATEGORY_COLORS[index % DEFAULT_CATEGORY_COLORS.length];
            const percentage = totalExpenses > 0 ? ((data.amount / totalExpenses) * 100).toFixed(1) : '0';

            return {
                categoryId,
                name,
                amount: data.amount,
                percentage,
                color,
                transactionCount: data.count,
            };
        })
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
    const expenses = periodTxs.filter((tx) => tx.type === 'DEBIT' && !tx.isTransfer).reduce((sum, tx) => sum + tx.amount, 0);

    const totalDays = getDaysInclusive(startDate, endDate);
    const earliestTx = getEarliestTransactionDate(periodTxs);

    // Days elapsed with recorded activity or account lifetime
    let activeDays = totalDays;
    if (earliestTx) {
        const daysSinceFirst = getDaysInclusive(earliestTx, endDate);
        activeDays = Math.min(totalDays, daysSinceFirst);
    } else if (accountCreatedDate) {
        const daysSinceCreated = getDaysInclusive(accountCreatedDate, endDate);
        activeDays = Math.min(totalDays, daysSinceCreated);
    }

    // Requires at least 2 active calendar days and actual expenses to provide a non-misleading average
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
        const bucketExpenses = bucketTxs
            .filter((tx) => tx.type === 'DEBIT' && !tx.isTransfer)
            .reduce((sum, tx) => sum + tx.amount, 0);
        values.push(bucketExpenses);
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

    // Eligible transactions
    const eligibleTxs = transactions.filter((tx) => {
        if (tx.type !== 'DEBIT' || tx.status !== 'CLEARED' || tx.isTransfer) return false;
        if (tx.categoryId !== budget.categoryId) return false;
        if (budget.walletId && tx.walletId !== budget.walletId) return false;

        const txLocalDate = getEthiopianDateString(tx.date);
        return txLocalDate >= budget.startDate && txLocalDate <= budget.endDate;
    });

    const spent = Number(eligibleTxs.reduce((sum, tx) => sum + tx.amount, 0).toFixed(2));
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
 * Generates explainable, deterministic financial insights backed strictly by real data.
 */
export function generateFinancialInsights(
    summary: PeriodSummary,
    period: AnalyticsPeriod,
    categories: CategoryBreakdownItem[],
    dailySpending: DailySpendingMetrics,
    budgetMetricsList: BudgetMetrics[]
): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const periodLabel = period.toLowerCase();

    // 1. Cash flow insight
    if (summary.transactionCount > 0) {
        if (summary.netCashFlow > 0) {
            const savingsRate = summary.income > 0 ? Math.round((summary.netCashFlow / summary.income) * 100) : 100;
            insights.push({
                id: 'cf_surplus',
                type: 'cash_flow',
                title: 'Positive Cash Flow',
                description: `You saved ${formatEtb(summary.netCashFlow)} this ${periodLabel} (${savingsRate}% savings rate).`,
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

    // 4. Daily average spending pace
    if (dailySpending.hasSufficientData) {
        insights.push({
            id: 'daily_pace',
            type: 'daily_pace',
            title: 'Average Daily Spending',
            description: `You are spending an average of ${formatEtb(dailySpending.averageDaily)} per day across ${dailySpending.activeDays} days.`,
            sentiment: 'neutral',
        });
    }

    // 5. Budget warning / pacing alerts
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
