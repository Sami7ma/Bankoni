// app/(app)/AnalyticsScreen.tsx
//
// The analytics tab — spending trends, category breakdowns,
// budget pacing, and evidence-based financial intelligence.

import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
    AlertTriangle,
    TrendingUp,
    TrendingDown,
    Store,
    Users,
    Calendar,
    Wifi,
    ArrowDownLeft,
    ArrowUpRight,
} from 'lucide-react-native';

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
    calculateMerchantBreakdown,
    calculateReceivablesAndLiabilities,
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
    const sharedExpenses = useBanKoniStore((state) => state.sharedExpenses);
    const loans = useBanKoniStore((state) => state.loans);
    const recurringCommitments = useBanKoniStore((state) => state.recurringCommitments);
    const telecomPackages = useBanKoniStore((state) => state.telecomPackages);
    const telecomEvents = useBanKoniStore((state) => state.telecomEvents);

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

    // Merchant breakdown strictly within the selected period (using personal spending for shared bills)
    const topMerchants = useMemo(
        () =>
            calculateMerchantBreakdown(
                eligibleTransactions,
                dateRange.startDate,
                dateRange.endDate,
                sharedExpenses
            ),
        [eligibleTransactions, dateRange, sharedExpenses]
    );

    // Receivables and liabilities (shared expenses + loans)
    const receivablesAndLiabilities = useMemo(
        () => calculateReceivablesAndLiabilities(sharedExpenses, loans),
        [sharedExpenses, loans]
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
                    savingsRate={periodSummary.savingsRate}
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

                {/* TOP MERCHANTS — normalized places & shops breakdown */}
                {topMerchants.length > 0 && (
                    <View style={styles.section}>
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>Top Merchants</Text>
                            <Text style={styles.sectionSubtitle}>Recognized places & shops</Text>
                        </View>
                        <View style={styles.merchantsCard}>
                            {topMerchants.map((merchant, idx) => (
                                <View
                                    key={`${merchant.name}-${idx}`}
                                    style={[
                                        styles.merchantRow,
                                        idx < topMerchants.length - 1 && styles.merchantRowBorder,
                                    ]}
                                >
                                    <View style={styles.merchantLeft}>
                                        <View style={styles.merchantIconWrap}>
                                            <Store size={15} color={colors.champagne} />
                                        </View>
                                        <View style={styles.merchantInfo}>
                                            <Text style={styles.merchantName}>{merchant.name}</Text>
                                            <View style={styles.merchantBadgeRow}>
                                                {merchant.merchantType ? (
                                                    <View style={styles.merchantTypeBadge}>
                                                        <Text style={styles.merchantTypeText}>
                                                            {merchant.merchantType}
                                                        </Text>
                                                    </View>
                                                ) : null}
                                                <Text style={styles.merchantTxCount}>
                                                    {merchant.transactionCount} visit{merchant.transactionCount > 1 ? 's' : ''}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                    <View style={styles.merchantRight}>
                                        <Text style={styles.merchantAmount}>
                                            {formatEtb(merchant.amount)}
                                        </Text>
                                        <Text style={styles.merchantPercent}>
                                            {merchant.percentage}%
                                        </Text>
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {/* RECEIVABLES & DEBTS — split expenses and loans */}
                {(receivablesAndLiabilities.totalReceivables > 0 || receivablesAndLiabilities.totalLiabilities > 0) && (
                    <View style={styles.section}>
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>Receivables & Obligations</Text>
                            <Text style={styles.sectionSubtitle}>Shared expenses & debts</Text>
                        </View>
                        <View style={styles.receivablesCard}>
                            <View style={styles.receivableCol}>
                                <View style={styles.receivableHeaderRow}>
                                    <ArrowDownLeft size={14} color={colors.success} />
                                    <Text style={styles.receivableLabel}>OWED TO YOU</Text>
                                </View>
                                <Text style={[styles.receivableValue, { color: colors.success }]}>
                                    {formatEtb(receivablesAndLiabilities.totalReceivables)}
                                </Text>
                                <Text style={styles.receivableSub}>
                                    {formatEtb(receivablesAndLiabilities.sharedExpensesReceivable)} pending splits • {formatEtb(receivablesAndLiabilities.lentLoansReceivable)} loans
                                </Text>
                            </View>

                            <View style={styles.receivableDivider} />

                            <View style={styles.receivableCol}>
                                <View style={styles.receivableHeaderRow}>
                                    <ArrowUpRight size={14} color={colors.danger} />
                                    <Text style={styles.receivableLabel}>YOU OWE</Text>
                                </View>
                                <Text style={[styles.receivableValue, { color: colors.danger }]}>
                                    {formatEtb(receivablesAndLiabilities.totalLiabilities)}
                                </Text>
                                <Text style={styles.receivableSub}>
                                    {formatEtb(receivablesAndLiabilities.borrowedLoansPayable)} outstanding debt
                                </Text>
                            </View>
                        </View>
                        <Text style={styles.receivableNote}>
                            Shared expense reimbursements reduce realized out-of-pocket costs and do not count as income.
                        </Text>
                    </View>
                )}

                {/* RECURRING COMMITMENTS — education, rent, utilities */}
                {recurringCommitments.length > 0 && (
                    <View style={styles.section}>
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>Recurring Commitments</Text>
                            <Text style={styles.sectionSubtitle}>Education, utilities & rent</Text>
                        </View>
                        <View style={styles.commitmentsCard}>
                            {recurringCommitments.slice(0, 5).map((commitment, idx) => (
                                <View
                                    key={commitment.id}
                                    style={[
                                        styles.commitmentRow,
                                        idx < Math.min(recurringCommitments.length, 5) - 1 && styles.commitmentRowBorder,
                                    ]}
                                >
                                    <View style={styles.commitmentLeft}>
                                        <View style={styles.commitmentIconWrap}>
                                            <Calendar size={15} color={colors.champagne} />
                                        </View>
                                        <View style={styles.commitmentInfo}>
                                            <Text style={styles.commitmentName}>{commitment.name}</Text>
                                            <Text style={styles.commitmentMeta}>
                                                {commitment.frequency} • Next: {commitment.nextExpectedDate || 'Scheduled'}
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={styles.commitmentRight}>
                                        <Text style={styles.commitmentAmount}>
                                            {commitment.expectedAmount ? formatEtb(commitment.expectedAmount) : 'Variable'}
                                        </Text>
                                        <View
                                            style={[
                                                styles.commitmentStatusBadge,
                                                {
                                                    backgroundColor:
                                                        commitment.status === 'PAUSED' || commitment.status === 'CANCELLED'
                                                            ? `${colors.danger}18`
                                                            : `${colors.success}18`,
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.commitmentStatusText,
                                                    {
                                                        color:
                                                            commitment.status === 'PAUSED' || commitment.status === 'CANCELLED'
                                                                ? colors.danger
                                                                : colors.success,
                                                    },
                                                ]}
                                            >
                                                {commitment.status}
                                            </Text>
                                        </View>
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {/* TELECOM INTELLIGENCE — packages and service events */}
                {(telecomPackages.length > 0 || telecomEvents.length > 0) && (
                    <View style={styles.section}>
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>Telecom Intelligence</Text>
                            <Text style={styles.sectionSubtitle}>Packages & service events</Text>
                        </View>
                        <View style={styles.telecomCard}>
                            {telecomPackages.map((pkg) => (
                                <View key={pkg.id} style={styles.telecomPkgRow}>
                                    <View style={styles.telecomIconWrap}>
                                        <Wifi size={15} color={colors.champagne} />
                                    </View>
                                    <View style={styles.telecomInfo}>
                                        <Text style={styles.telecomPkgName}>{pkg.packageName}</Text>
                                        <Text style={styles.telecomMeta}>
                                            {pkg.category.toUpperCase()} • {pkg.isActive ? 'Active' : 'Inactive'}{pkg.validityPeriod ? ` • ${pkg.validityPeriod}` : ''}
                                        </Text>
                                    </View>
                                </View>
                            ))}
                            {telecomEvents.slice(0, 3).map((evt, idx) => (
                                <View
                                    key={evt.id}
                                    style={[
                                        styles.telecomEventRow,
                                        idx > 0 && styles.telecomEventBorder,
                                    ]}
                                >
                                    <View style={styles.telecomEventDot} />
                                    <Text style={styles.telecomEventText} numberOfLines={2}>
                                        {evt.eventType}: {evt.rawSms}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

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
        sectionHeaderRow: {
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
        },
        sectionSubtitle: {
            fontSize: 12,
            color: colors.textSecondary,
        },
        merchantsCard: {
            backgroundColor: 'transparent',
            overflow: 'hidden',
        },
        merchantRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 12,
            paddingHorizontal: 2,
        },
        merchantRowBorder: {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
        },
        merchantLeft: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            flex: 1,
        },
        merchantIconWrap: {
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: `${colors.champagne}18`,
            alignItems: 'center',
            justifyContent: 'center',
        },
        merchantInfo: {
            gap: 2,
            flex: 1,
        },
        merchantName: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        merchantBadgeRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        merchantTypeBadge: {
            backgroundColor: `${colors.champagne}15`,
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: 4,
        },
        merchantTypeText: {
            fontSize: 10,
            color: colors.champagne,
            fontWeight: '600',
        },
        merchantTxCount: {
            fontSize: 11,
            color: colors.textMuted,
        },
        merchantRight: {
            alignItems: 'flex-end',
            gap: 2,
        },
        merchantAmount: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        merchantPercent: {
            fontSize: 11,
            color: colors.textSecondary,
        },
        receivablesCard: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: 'transparent',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            borderRadius: 8,
            paddingVertical: 12,
            paddingHorizontal: 12,
        },
        receivableCol: {
            flex: 1,
            gap: 4,
        },
        receivableHeaderRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
        },
        receivableLabel: {
            fontSize: 10,
            fontWeight: '700',
            color: colors.textSecondary,
            letterSpacing: 0.5,
        },
        receivableValue: {
            fontSize: 16,
            fontWeight: '700',
        },
        receivableSub: {
            fontSize: 10,
            color: colors.textMuted,
        },
        receivableDivider: {
            width: 1,
            height: 40,
            backgroundColor: colors.border,
            marginHorizontal: 10,
        },
        receivableNote: {
            fontSize: 11,
            color: colors.textMuted,
            fontStyle: 'italic',
            marginTop: 4,
            paddingHorizontal: 2,
        },
        commitmentsCard: {
            backgroundColor: 'transparent',
        },
        commitmentRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 11,
            paddingHorizontal: 2,
        },
        commitmentRowBorder: {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
        },
        commitmentLeft: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            flex: 1,
        },
        commitmentIconWrap: {
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: `${colors.champagne}18`,
            alignItems: 'center',
            justifyContent: 'center',
        },
        commitmentInfo: {
            flex: 1,
            gap: 2,
        },
        commitmentName: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        commitmentMeta: {
            fontSize: 11,
            color: colors.textSecondary,
        },
        commitmentRight: {
            alignItems: 'flex-end',
            gap: 3,
        },
        commitmentAmount: {
            fontSize: 13,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        commitmentStatusBadge: {
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 4,
        },
        commitmentStatusText: {
            fontSize: 10,
            fontWeight: '700',
        },
        telecomCard: {
            backgroundColor: 'transparent',
        },
        telecomPkgRow: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 10,
            gap: 10,
        },
        telecomIconWrap: {
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: `${colors.champagne}18`,
            alignItems: 'center',
            justifyContent: 'center',
        },
        telecomInfo: {
            flex: 1,
            gap: 2,
        },
        telecomPkgName: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        telecomMeta: {
            fontSize: 11,
            color: colors.textSecondary,
        },
        telecomPrice: {
            fontSize: 13,
            fontWeight: '600',
            color: colors.champagne,
        },
        telecomEventRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 7,
        },
        telecomEventBorder: {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
        },
        telecomEventDot: {
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.champagne,
        },
        telecomEventText: {
            fontSize: 11,
            color: colors.textSecondary,
            flex: 1,
        },
        emptyText: {
            fontSize: 13,
            color: colors.textMuted,
            paddingVertical: 12,
            textAlign: 'center',
        },
    });
