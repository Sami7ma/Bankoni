// app/(app)/AnalyticsScreen.tsx
//
// The analytics tab — spending trends and category breakdowns.
//
// REFACTORED: This screen now only handles DATA and LOGIC.
// All UI rendering is delegated to dedicated components:
//   - SummaryCards     → income vs expenses cards
//   - PeriodTabs       → Week/Month/Year animated selector
//   - SpendingLineChart → the line graph
//   - TopSpendingList  → category breakdown rows
//
// Data Flow:
// 1. Read transactions + categories from Zustand
// 2. User selects period via PeriodTabs → updates local state
// 3. useMemo groups expenses into time buckets for the chart
// 4. useMemo groups expenses by category for the top spending list
// 5. Computed data is passed as props to child components

import { useState, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import useTheme from "../../hooks/useTheme";
import useBanKoniStore from "../../store/useBanKoniStore";

// ── COMPONENTS ───────────────────────────────────────────
// Each one handles its own UI + styles.
// This screen just passes data to them.
import SummaryCards from "../../components/common/charts/SummaryCards";
import PeriodTabs from "../../components/common/buttons/PeriodTabs";
import SpendingLineChart from "../../components/common/charts/SpendingLineChart";
import TopSpendingList, { SpendingCategory } from "../../components/common/charts/TopSpendingList";

// ── TYPES ────────────────────────────────────────────────
type Period = 'Week' | 'Month' | 'Year';

// ── CONSTANTS ────────────────────────────────────────────
// Colors for the top spending list dots
const CATEGORY_COLORS = [
    '#C9A84C', '#E74C3C', '#2ECC71', '#3498DB',
    '#9B59B6', '#E67E22', '#1ABC9C', '#F39C12',
    '#E91E63', '#00BCD4', '#8BC34A', '#FF5722',
];

// Short month and day name lookups
const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const DAY_NAMES = [
    'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
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
    const categories = useBanKoniStore((state) => state.categories);
    const totalIncome = useBanKoniStore((state) => state.totalIncome);
    const totalExpenses = useBanKoniStore((state) => state.totalExpenses);
    const budgets = useBanKoniStore((state) => state.budgets);

    // ── HELPER ───────────────────────────────────────────
    const getCategoryName = (id: string) =>
        categories.find((cat) => cat.id === id)?.name ?? 'Unknown';
    //  budgets list data
    const budgetList = useMemo(() => {
        return budgets.map((b) => {
            const spent = transactions
                .filter((tx) => tx.type === 'DEBIT' && tx.categoryId === b.categoryId)
                .reduce((acc, tx) => acc + tx.amount, 0)
            return {
                id: b.id,
                categoryName: getCategoryName(b.categoryId),
                spent,
                limit: b.limitAmount
            };
        });
    }, [budgets, transactions, getCategoryName])

    // ── COMPUTE: chart data based on period ──────────────
    // Groups expenses into time buckets for the line chart.
    // useMemo caches the result — only recalculates when
    // transactions or period changes.
    const chartData = useMemo(() => {
        const now = new Date();
        const expenses = transactions.filter((tx) => tx.type === 'DEBIT');

        if (period === 'Week') {
            // 7 buckets, one per day
            const labels: string[] = [];
            const values: number[] = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date(now);
                d.setDate(now.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                labels.push(DAY_NAMES[d.getDay()]);
                const dayTotal = expenses
                    .filter((tx) => tx.date.split('T')[0] === dateStr)
                    .reduce((sum, tx) => sum + tx.amount, 0);
                values.push(dayTotal);
            }
            return { labels, values };
        }

        if (period === 'Month') {
            // 4 buckets, one per week
            const labels: string[] = [];
            const values: number[] = [];
            for (let i = 3; i >= 0; i--) {
                const weekEnd = new Date(now);
                weekEnd.setDate(now.getDate() - (i * 7));
                const weekStart = new Date(weekEnd);
                weekStart.setDate(weekEnd.getDate() - 6);
                labels.push(
                    `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getDate()}`
                );
                const startStr = weekStart.toISOString().split('T')[0];
                const endStr = weekEnd.toISOString().split('T')[0];
                const weekTotal = expenses
                    .filter((tx) => {
                        const txDate = tx.date.split('T')[0];
                        return txDate >= startStr && txDate <= endStr;
                    })
                    .reduce((sum, tx) => sum + tx.amount, 0);
                values.push(weekTotal);
            }
            return { labels, values };
        }

        // Year: 6 buckets, one per month
        const labels: string[] = [];
        const values: number[] = [];
        for (let i = 5; i >= 0; i--) {
            const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthIndex = monthDate.getMonth();
            const year = monthDate.getFullYear();
            labels.push(MONTH_NAMES[monthIndex]);
            const monthTotal = expenses
                .filter((tx) => {
                    const txDate = new Date(tx.date);
                    return txDate.getMonth() === monthIndex
                        && txDate.getFullYear() === year;
                })
                .reduce((sum, tx) => sum + tx.amount, 0);
            values.push(monthTotal);
        }
        return { labels, values };
    }, [transactions, period]);

    // ── COMPUTE: top spending categories ─────────────────
    // Groups expenses by category, sums, sorts by highest.
    // Also calculates percentage for each category.
    const topSpending: SpendingCategory[] = useMemo(() => {
        const expenses = transactions.filter((tx) => tx.type === 'DEBIT');

        const grouped = expenses.reduce((acc, tx) => {
            acc[tx.categoryId] = (acc[tx.categoryId] || 0) + tx.amount;
            return acc;
        }, {} as Record<string, number>);

        const sorted = Object.entries(grouped)
            .map(([categoryId, amount]: [string, number], index) => ({
                categoryId,
                name: getCategoryName(categoryId),
                amount,
                color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
            }))
            .sort((a, b) => b.amount - a.amount);

        // Calculate percentages
        const total = sorted.reduce((sum, cat) => sum + cat.amount, 0);
        return sorted.map((cat) => ({
            ...cat,
            percentage: total > 0
                ? ((cat.amount / total) * 100).toFixed(1)
                : '0',
        }));
    }, [transactions, categories]);

    // ── UI ───────────────────────────────────────────────
    // Notice how clean this is now — just components + data.
    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar style={colors.statusBar} />

            {/* HEADER */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Analytics</Text>
                <Text style={styles.headerSubtitle}>
                    Your spending overview
                </Text>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* INCOME vs EXPENSES — was 25 lines, now 1 component */}
                <SummaryCards
                    totalIncome={totalIncome()}
                    totalExpenses={totalExpenses()}
                />

                {/* SPENDING TREND — chart + period selector */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Spending Trend</Text>

                    {/* PERIOD TABS — was 35 lines of animation code, now 1 component */}
                    <PeriodTabs
                        selected={period}
                        onSelect={setPeriod}
                    />

                    {/* LINE CHART — already its own component */}
                    <SpendingLineChart
                        labels={chartData.labels}
                        values={chartData.values}
                    />
                </View>

                {/* TOP SPENDING — was 45 lines of map/render, now 1 component */}
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
                                <Text style={styles.budgetName}>{item.categoryName}</Text>
                                <Text style={styles.budgetAmount}>
                                    ETB {item.spent.toLocaleString()} / ETB {item.limit.toLocaleString()}
                                </Text>
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
// Only the screen-level layout styles remain here.
// All component-specific styles live inside their own files.
const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        safeArea: {
            flex: 1,
            backgroundColor: colors.background,
        },
        header: {
            paddingHorizontal: 10,
            paddingTop: 2,
            paddingBottom: 12,
        },
        headerTitle: {
            fontSize: 28,
            fontWeight: 'bold',
            color: colors.textPrimary,
        },
        headerSubtitle: {
            fontSize: 14,
            color: colors.textSecondary,
            marginTop: 2,
        },
        scrollContent: {
            paddingHorizontal: 10,
            paddingBottom: 32,
            gap: 20,
        },
        section: {
            gap: 10,
        },
        sectionTitle: {
            fontSize: 16,
            fontWeight: '700',
            color: colors.textPrimary,
        },
        budgetCard: {
            backgroundColor: colors.surface,
            borderRadius: 16,
            paddingHorizontal: 16,
            borderWidth: 1,
            borderColor: colors.border,
        },
        budgetRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 14,
        },
        budgetRowBorder: {
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        budgetName: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        budgetAmount: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textSecondary,
        },
        emptyText: {
            fontSize: 14,
            color: colors.textMuted,
            paddingVertical: 16,
            textAlign: 'center',
        },

    });
