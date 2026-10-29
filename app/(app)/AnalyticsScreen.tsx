// app/(app)/AnalyticsScreen.tsx
//
// The analytics tab — spending trends, category breakdowns,
// budget pacing, and evidence-based financial intelligence.

import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react-native';

import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';

// ── COMPONENTS ───────────────────────────────────────────
import SummaryCards from '../../components/common/charts/SummaryCards';
import PeriodTabs, { Period } from '../../components/common/buttons/PeriodTabs';
import SpendingLineChart from '../../components/common/charts/SpendingLineChart';
import TopSpendingList from '../../components/common/charts/TopSpendingList';

// ── UTILITIES & CALCULATIONS ─────────────────────────────
import { getTodayEthiopianDateString, getPeriodDateRange } from '../../utils/date';
import {
    filterEligibleTransactions,
    calculatePeriodSummary,
    calculateCategoryBreakdown,
    calculateDailySpending,
    calculateChartData,
    calculateBudgetMetrics,
    generateFinancialInsights,
} from '../../utils/financial';
import { formatEtb } from '../../utils/format';

// ── CONSTANTS ────────────────────────────────────────────
const CATEGORY_COLORS = [
    '#C9A84C', '#E74C3C', '#2ECC71', '#3498DB',
    '#9B59B6', '#E67E22', '#1ABC9C', '#F39C12',
    '#E91E63', '#00BCD4', '#8BC34A', '#FF5722',
];

// ══════════════════════════════════════════════════════════
// SCREEN
// ══════════════════════════════════════════════════════════
export default function AnalyticsScreen() {
    const colors = useTheme();
    const styles = createStyles(colors);

    // ── LOCAL STATE ──────────────────────────────────────
    const [period, setPeriod] = useState<Period>('Month');

    // ── ZUSTAND ──────────────────────────────────────────
    const transactions = useBanKoniStore((state) => state.transactions);
    const wallets = useBanKoniStore((state) => state.wallets);
    const categories = useBanKoniStore((state) => state.categories);
    const budgets = useBanKoniStore((state) => state.budgets);

    // Current Ethiopian local calendar date (EAT UTC+3)
    const todayStr = useMemo(() => getTodayEthiopianDateString(), []);

    // Active period date boundaries
    const dateRange = useMemo(
        () => getPeriodDateRange(period, todayStr),
        [period, todayStr]
    );

    // Filter cleared transactions from active wallets
    const eligibleTransactions = useMemo(
        () => filterEligibleTransactions(transactions, wallets),
        [transactions, wallets]
    );

    // Period summary: Income, Expenses, Net Cash Flow, Fair Prior Comparison
    const periodSummary = useMemo(
        () => calculatePeriodSummary(eligibleTransactions, dateRange),
        [eligibleTransactions, dateRange]
    );

    // Daily spending pace
    const dailySpending = useMemo(
        () =>
            calculateDailySpending(
                eligibleTransactions,
                dateRange.startDate,
                dateRange.endDate
            ),
        [eligibleTransactions, dateRange]
    );

    // Chart data for spending trend line graph
    const chartData = useMemo(
        () => calculateChartData(eligibleTransactions, dateRange),
        [eligibleTransactions, dateRange]
    );

    // Category breakdown strictly within the selected period
    const topSpending = useMemo(
        () =>
            calculateCategoryBreakdown(
                eligibleTransactions,
                categories,
                dateRange.startDate,
                dateRange.endDate
            ),
        [eligibleTransactions, categories, dateRange]
    );

    // Budget metrics and status evaluation
    const budgetMetricsList = useMemo(
        () =>
            budgets.map((b) =>
                calculateBudgetMetrics(b, eligibleTransactions, todayStr)
            ),
        [budgets, eligibleTransactions, todayStr]
    );

    // Budgets display items
    const budgetList = useMemo(() => {
        return budgets.map((b, idx) => {
            const metrics = budgetMetricsList[idx];
            const cat = categories.find((c) => c.id === b.categoryId);
            return {
                id: b.id,
                categoryName: cat?.name ?? 'Unknown',
                spent: metrics.spent,
                limit: metrics.limitAmount,
                remaining: metrics.remaining,
                percentage: metrics.percentage,
                status: metrics.status,
                daysRemaining: metrics.daysRemaining,
            };
        });
    }, [budgets, budgetMetricsList, categories]);

    // Financial intelligence insights
    const financialInsights = useMemo(
        () =>
            generateFinancialInsights(
                periodSummary,
                period,
                topSpending,
                dailySpending,
                budgetMetricsList
            ),
        [periodSummary, period, topSpending, dailySpending, budgetMetricsList]
    );

    const periodLabel =
        period === 'Week'
            ? 'This week'
            : period === 'Month'
            ? 'This month'
            : 'This year';

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar style={colors.statusBar} />

            {/* HEADER */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Analytics</Text>
                <Text style={styles.headerSubtitle}>
                    Financial intelligence for {periodLabel.toLowerCase()}
                </Text>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* PERIOD TABS */}
                <PeriodTabs
                    selected={period}
                    onSelect={setPeriod}
                />

                {/* PERIOD SUMMARY: INCOME, EXPENSES, NET CASH FLOW */}
                <SummaryCards
                    totalIncome={periodSummary.income}
                    totalExpenses={periodSummary.expenses}
                    netCashFlow={periodSummary.netCashFlow}
                    periodLabel={periodLabel}
                    expenseChangePercentage={periodSummary.expenseChangePercentage}
                    incomeChangePercentage={periodSummary.incomeChangePercentage}
                    hasSufficientPriorHistory={periodSummary.hasSufficientPriorHistory}
                    averageDailySpending={dailySpending.hasSufficientData ? dailySpending.averageDaily : null}
                    activeSpendingDays={dailySpending.activeDays}
                />

                {/* SPENDING TREND — chart */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Spending Trend</Text>
                    <SpendingLineChart
                        labels={chartData.labels}
                        values={chartData.values}
                    />
                </View>

                {/* EVIDENCE-BASED FINANCIAL INSIGHTS */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Financial Insights</Text>
                    {financialInsights.length > 0 ? (
                        <View style={styles.insightsCard}>
                            {financialInsights.map((insight, index) => {
                                const isPositive = insight.sentiment === 'positive';
                                const isWarning =
                                    insight.sentiment === 'warning' ||
                                    insight.sentiment === 'negative';
                                const iconColor = isPositive
                                    ? colors.success
                                    : isWarning
                                    ? colors.danger
                                    : colors.champagne;

                                return (
                                    <View
                                        key={insight.id}
                                        style={[
                                            styles.insightRow,
                                            index < financialInsights.length - 1 &&
                                                styles.insightRowBorder,
                                        ]}
                                    >
                                        <View
                                            style={[
                                                styles.insightIconWrap,
                                                { backgroundColor: `${iconColor}14` },
                                            ]}
                                        >
                                            {isWarning ? (
                                                <AlertTriangle size={16} color={iconColor} />
                                            ) : isPositive ? (
                                                <TrendingUp size={16} color={iconColor} />
                                            ) : (
                                                <TrendingDown size={16} color={iconColor} />
                                            )}
                                        </View>
                                        <View style={styles.insightContent}>
                                            <View style={styles.insightHeaderRow}>
                                                <Text style={styles.insightTitle}>
                                                    {insight.title}
                                                </Text>
                                            </View>
                                            <Text style={styles.insightDescription}>
                                                {insight.description}
                                            </Text>
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    ) : (
                        <View style={styles.emptyInsights}>
                            <Text style={styles.emptyText}>
                                Insufficient spending history in this period to establish reliable insights.
                            </Text>
                        </View>
                    )}
                </View>

                {/* TOP SPENDING — category breakdown strictly within selected period */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Top Spendings</Text>
                    <TopSpendingList data={topSpending} />
                </View>

                {/* BUDGETS LIST */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Budgets</Text>
                    <View style={styles.budgetCard}>
                        {budgetList.map((item, index) => (
                            <View
                                key={item.id}
                                style={[
                                    styles.budgetRow,
                                    index < budgetList.length - 1 && styles.budgetRowBorder,
                                ]}
                            >
                                <View style={styles.budgetLeft}>
                                    <Text style={styles.budgetName}>{item.categoryName}</Text>
                                    <Text style={styles.budgetPaceText}>
                                        {Math.round(item.percentage * 100)}% used •{' '}
                                        {item.remaining >= 0
                                            ? `${formatEtb(item.remaining, { abs: true })} left`
                                            : `${formatEtb(item.remaining, { abs: true })} over`}
                                    </Text>
                                </View>
                                <View style={styles.budgetRight}>
                                    <Text style={styles.budgetAmount}>
                                        {formatEtb(item.spent, { abs: true })} / {formatEtb(item.limit, { abs: true })}
                                    </Text>
                                    {item.status === 'PACING_OVER' && (
                                        <Text style={[styles.budgetWarningBadge, { color: colors.champagne }]}>
                                            Pacing over
                                        </Text>
                                    )}
                                    {item.status === 'WARNING' && (
                                        <Text style={[styles.budgetWarningBadge, { color: colors.champagne }]}>
                                            Near limit
                                        </Text>
                                    )}
                                    {item.status === 'EXCEEDED' && (
                                        <Text style={[styles.budgetWarningBadge, { color: colors.danger }]}>
                                            Exceeded
                                        </Text>
                                    )}
                                </View>
                            </View>
                        ))}
                        {budgetList.length === 0 && (
                            <Text style={styles.emptyText}>No budgets created yet</Text>
                        )}
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

// ── STYLES ───────────────────────────────────────────────
const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        safeArea: {
            flex: 1,
            backgroundColor: colors.background,
        },
        header: {
            paddingHorizontal: 12,
            paddingTop: Platform.OS === 'ios' ? 14 : 8,
            paddingBottom: 8,
        },
        headerTitle: {
            fontSize: 28,
            fontWeight: '700',
            letterSpacing: 0.3,
            color: colors.textPrimary,
        },
        headerSubtitle: {
            fontSize: 13,
            color: colors.textSecondary,
            marginTop: 2,
        },
        scrollContent: {
            paddingHorizontal: 12,
            paddingBottom: 90,
            gap: 18,
        },
        section: {
            gap: 10,
        },
        sectionTitle: {
            fontSize: 17,
            fontWeight: '700',
            letterSpacing: 0.2,
            color: colors.textPrimary,
        },
        insightsCard: {
            backgroundColor: 'transparent',
            borderRadius: 8,
            overflow: 'hidden',
        },
        insightRow: {
            flexDirection: 'row',
            alignItems: 'flex-start',
            paddingVertical: 11,
            paddingHorizontal: 2,
            gap: 10,
        },
        insightRowBorder: {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
        },
        insightIconWrap: {
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 1,
        },
        insightContent: {
            flex: 1,
            gap: 3,
        },
        insightHeaderRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        insightTitle: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textPrimary,
            flex: 1,
        },
        insightBadge: {
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 4,
            marginLeft: 6,
        },
        insightBadgeText: {
            fontSize: 11,
            fontWeight: '700',
        },
        insightDescription: {
            fontSize: 12,
            color: colors.textSecondary,
            lineHeight: 17,
        },
        emptyInsights: {
            paddingVertical: 12,
        },
        budgetCard: {
            backgroundColor: 'transparent',
        },
        budgetRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 12,
            paddingHorizontal: 2,
        },
        budgetRowBorder: {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
        },
        budgetLeft: {
            flex: 1,
            gap: 2,
        },
        budgetName: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        budgetPaceText: {
            fontSize: 12,
            color: colors.textSecondary,
        },
        budgetRight: {
            alignItems: 'flex-end',
            gap: 2,
        },
        budgetAmount: {
            fontSize: 13,
            fontWeight: '600',
            color: colors.textSecondary,
        },
        budgetWarningBadge: {
            fontSize: 11,
            fontWeight: '700',
        },
        emptyText: {
            fontSize: 13,
            color: colors.textMuted,
            paddingVertical: 12,
            textAlign: 'center',
        },
    });
