// components/common/charts/SummaryCards.tsx
//
// Financial summary cards showing period-filtered Income, Expenses,
// Net Cash Flow, and fair prior-period comparisons.

import { View, Text, StyleSheet } from 'react-native';
import { TrendingUp, TrendingDown } from 'lucide-react-native';
import useTheme from '../../../hooks/useTheme';
import { formatEtb } from '../../../utils/format';

// ── PROPS ────────────────────────────────────────────────
export interface SummaryCardsProps {
    totalIncome: number;
    totalExpenses: number;
    netCashFlow: number;
    periodLabel?: string;
    expenseChangePercentage?: number | null;
    incomeChangePercentage?: number | null;
    hasSufficientPriorHistory?: boolean;
    averageDailySpending?: number | null;
    activeSpendingDays?: number;
}

export default function SummaryCards({
    totalIncome,
    totalExpenses,
    netCashFlow,
    periodLabel,
    expenseChangePercentage,
    incomeChangePercentage,
    hasSufficientPriorHistory,
    averageDailySpending,
}: SummaryCardsProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    const isSurplus = netCashFlow > 0;
    const isDeficit = netCashFlow < 0;

    return (
        <View style={styles.container}>
            {/* ROW 1: INCOME & EXPENSES */}
            <View style={styles.metricsRow}>
                {/* INCOME */}
                <View style={styles.item}>
                    <View style={styles.iconRow}>
                        <TrendingUp size={14} color={colors.success} />
                        <Text style={styles.label}>Income</Text>
                    </View>
                    <Text
                        style={[styles.amount, { color: colors.success }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                    >
                        {formatEtb(totalIncome)}
                    </Text>
                    {hasSufficientPriorHistory && incomeChangePercentage !== null && incomeChangePercentage !== undefined ? (
                        <Text style={styles.comparisonText}>
                            {incomeChangePercentage > 0 ? '+' : ''}
                            {incomeChangePercentage.toFixed(1)}% vs prior
                        </Text>
                    ) : (
                        <Text style={styles.comparisonSubtle}>
                            {periodLabel ?? 'This period'}
                        </Text>
                    )}
                </View>

                {/* DIVIDER */}
                <View style={styles.divider} />

                {/* EXPENSES */}
                <View style={styles.item}>
                    <View style={styles.iconRow}>
                        <TrendingDown size={14} color={colors.danger} />
                        <Text style={styles.label}>Expenses</Text>
                    </View>
                    <Text
                        style={[styles.amount, { color: colors.danger }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                    >
                        {formatEtb(totalExpenses)}
                    </Text>
                    {hasSufficientPriorHistory && expenseChangePercentage !== null && expenseChangePercentage !== undefined ? (
                        <Text style={styles.comparisonText}>
                            {expenseChangePercentage > 0 ? '+' : ''}
                            {expenseChangePercentage.toFixed(1)}% vs prior
                        </Text>
                    ) : (
                        <Text style={styles.comparisonSubtle}>
                            {periodLabel ?? 'This period'}
                        </Text>
                    )}
                </View>
            </View>

            {/* ROW 2: NET CASH FLOW & DAILY PACE */}
            <View style={styles.cashFlowRow}>
                <View style={styles.cashFlowLeft}>
                    <Text style={styles.cashFlowLabel}>NET CASH FLOW</Text>
                    <Text
                        style={[
                            styles.cashFlowAmount,
                            {
                                color: isSurplus
                                    ? colors.success
                                    : isDeficit
                                    ? colors.danger
                                    : colors.textSecondary,
                            },
                        ]}
                    >
                        {isSurplus ? '+' : ''}{formatEtb(netCashFlow)}
                    </Text>
                </View>

                <View style={styles.cashFlowRight}>
                    {averageDailySpending !== null && averageDailySpending !== undefined ? (
                        <View style={styles.dailyPaceWrap}>
                            <Text style={styles.dailyPaceLabel}>DAILY PACE</Text>
                            <Text style={styles.dailyPaceValue}>
                                {formatEtb(averageDailySpending)}/day
                            </Text>
                        </View>
                    ) : (
                        <View
                            style={[
                                styles.badge,
                                {
                                    backgroundColor: isSurplus
                                        ? 'rgba(46, 204, 113, 0.12)'
                                        : isDeficit
                                        ? 'rgba(231, 76, 60, 0.12)'
                                        : 'rgba(255, 255, 255, 0.06)',
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.badgeText,
                                    {
                                        color: isSurplus
                                            ? colors.success
                                            : isDeficit
                                            ? colors.danger
                                            : colors.textMuted,
                                    },
                                ]}
                            >
                                {isSurplus ? 'Surplus' : isDeficit ? 'Deficit' : 'Balanced'}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        </View>
    );
}

// ── STYLES ───────────────────────────────────────────────
const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        container: {
            backgroundColor: 'transparent',
            paddingVertical: 10,
            paddingHorizontal: 2,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
            marginBottom: 2,
            gap: 12,
        },
        metricsRow: {
            flexDirection: 'row',
            alignItems: 'center',
        },
        item: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
        },
        divider: {
            width: 1,
            height: 36,
            alignSelf: 'center',
            backgroundColor: colors.border,
            marginHorizontal: 10,
        },
        iconRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
        },
        label: {
            fontSize: 11,
            fontWeight: '600',
            color: colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            textAlign: 'center',
        },
        amount: {
            fontSize: 18,
            fontWeight: '700',
            marginTop: 2,
            textAlign: 'center',
        },
        comparisonText: {
            fontSize: 10,
            fontWeight: '600',
            color: colors.champagne,
            marginTop: 2,
        },
        comparisonSubtle: {
            fontSize: 10,
            color: colors.textMuted,
            marginTop: 2,
        },
        cashFlowRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 8,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            paddingHorizontal: 6,
        },
        cashFlowLeft: {
            gap: 2,
        },
        cashFlowLabel: {
            fontSize: 10,
            fontWeight: '700',
            color: colors.textSecondary,
            letterSpacing: 0.8,
        },
        cashFlowAmount: {
            fontSize: 15,
            fontWeight: '700',
        },
        cashFlowRight: {
            alignItems: 'flex-end',
        },
        dailyPaceWrap: {
            alignItems: 'flex-end',
            gap: 2,
        },
        dailyPaceLabel: {
            fontSize: 10,
            fontWeight: '700',
            color: colors.textSecondary,
            letterSpacing: 0.8,
        },
        dailyPaceValue: {
            fontSize: 13,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        badge: {
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 6,
        },
        badgeText: {
            fontSize: 11,
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
        },
    });
