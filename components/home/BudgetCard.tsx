// components/home/BudgetCard.tsx
//
// A single budget card in the budget list.
// Displays budget limit, actual eligible spending, remaining balance,
// percentage used, days remaining, and spending pace overrun projections.

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Pencil, Trash2 } from 'lucide-react-native';
import { Budget } from '../../types/Budget';
import { Category } from '../../types/Category';
import useBanKoniStore from '../../store/useBanKoniStore';
import useTheme from '../../hooks/useTheme';
import CategoryIcon from '../common/icons/CategoryIcon';
import { formatEtb } from '../../utils/format';
import { BudgetMetrics } from '../../utils/financial';
import { formatEthiopianDateShort } from '../../utils/date';

interface BudgetCardProps {
    budget: Budget;
    category: Category | undefined;
    spent?: number;
    metrics?: BudgetMetrics;
    onEdit?: () => void;
    onDelete?: () => void;
    onPress?: () => void;
}

export default function BudgetCard({
    budget,
    category,
    spent: spentProp,
    metrics,
    onEdit,
    onDelete,
    onPress,
}: BudgetCardProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    const wallets = useBanKoniStore((state) => state.wallets);
    const wallet = wallets.find((w) => w.id === budget.walletId);

    const [isExpanded, setIsExpanded] = useState(false);

    const actualSpent = metrics ? metrics.spent : (spentProp ?? 0);
    const limitAmount = budget.limitAmount;
    const remaining = metrics ? metrics.remaining : (limitAmount - actualSpent);
    const percentage = metrics ? metrics.percentage / 100 : (limitAmount > 0 ? actualSpent / limitAmount : 0);

    const barWidth = Math.min(percentage, 1) * 100;

    const getBarColor = () => {
        if (metrics) {
            if (metrics.status === 'EXCEEDED' || metrics.status === 'WARNING') {
                return colors.danger;
            }
            if (metrics.status === 'PACING_OVER') {
                return colors.champagne;
            }
            return colors.success;
        }
        if (percentage >= 0.8) return colors.danger;
        if (percentage >= 0.5) return colors.champagne;
        return colors.success;
    };

    const barColor = getBarColor();

    const formatMoney = (amount: number) => formatEtb(amount, { abs: true });

    // Format dates with Ethiopian short format
    const startStr = formatEthiopianDateShort(budget.startDate);
    const endStr = formatEthiopianDateShort(budget.endDate);

    let timeRemainingLabel = '';
    if (metrics) {
        if (metrics.isBudgetEnded) {
            timeRemainingLabel = 'Ended';
        } else if (metrics.isBudgetFuture) {
            timeRemainingLabel = `Starts in ${metrics.daysRemaining}d`;
        } else if (metrics.daysRemaining === 0) {
            timeRemainingLabel = 'Ends today';
        } else if (metrics.daysRemaining === 1) {
            timeRemainingLabel = '1 day left';
        } else {
            timeRemainingLabel = `${metrics.daysRemaining} days left`;
        }
    }

    const periodText = timeRemainingLabel
        ? `${timeRemainingLabel} • ${startStr} – ${endStr}`
        : `${startStr} – ${endStr}`;

    return (
        <View style={[styles.card, isExpanded && styles.cardExpanded]}>
            <TouchableOpacity
                style={styles.cardInner}
                onPress={() => {
                    setIsExpanded((prev) => !prev);
                    onPress?.();
                }}
                activeOpacity={0.8}
            >
                {/* TOP ROW: Category & Wallet info */}
                <View style={styles.topRow}>
                    <View style={styles.categoryIconWrap}>
                        <CategoryIcon
                            iconKey={category?.iconKey}
                            color={category?.colorKey ?? colors.champagne}
                            size={22}
                            flow={category?.flow ?? 'EXPENSE'}
                        />
                    </View>
                    <View style={styles.categoryInfo}>
                        <View style={styles.titleRow}>
                            <Text style={styles.categoryName} numberOfLines={1}>
                                {category?.name ?? 'Uncategorized'}
                            </Text>
                            {wallet ? (
                                <Text style={styles.walletText} numberOfLines={1}>
                                    • {wallet.name}
                                </Text>
                            ) : null}
                        </View>
                        <Text style={styles.period} numberOfLines={1}>
                            {periodText}
                        </Text>
                    </View>
                </View>

                {/* PROGRESS BAR */}
                <View style={styles.barBackground}>
                    <View
                        style={[
                            styles.barFill,
                            {
                                width: `${barWidth}%`,
                                backgroundColor: barColor,
                            },
                        ]}
                    />
                </View>

                {/* METRICS ROW: percentage used & amounts */}
                <View style={styles.bottomRow}>
                    <Text style={[styles.percentText, { color: barColor }]}>
                        {Math.round(percentage * 100)}% used
                    </Text>
                    <View style={styles.amountRow}>
                        <Text style={styles.spentText} numberOfLines={1}>
                            {formatMoney(actualSpent)}
                        </Text>
                        <Text style={styles.limitText} numberOfLines={1}>
                            / {formatMoney(limitAmount)}
                        </Text>
                    </View>
                </View>

                {/* STATUS & PACING MESSAGE */}
                <View style={styles.statusRow}>
                    <Text
                        style={[
                            styles.statusMessage,
                            {
                                color:
                                    metrics?.status === 'EXCEEDED'
                                        ? colors.danger
                                        : metrics?.status === 'WARNING' || metrics?.status === 'PACING_OVER'
                                        ? colors.champagne
                                        : colors.textSecondary,
                            },
                        ]}
                        numberOfLines={1}
                    >
                        {metrics?.statusMessage ?? (remaining >= 0 ? 'On track' : 'Over limit')}
                    </Text>
                    <Text
                        style={[
                            styles.remainingText,
                            {
                                color: remaining < 0 ? colors.danger : colors.textSecondary,
                            },
                        ]}
                        numberOfLines={1}
                    >
                        {remaining >= 0
                            ? `${formatMoney(remaining)} left`
                            : `${formatMoney(Math.abs(remaining))} over`}
                    </Text>
                </View>
            </TouchableOpacity>

            {/* EXPANDED ACTION TRAY */}
            {isExpanded && (
                <View style={styles.actionTray}>
                    <TouchableOpacity
                        style={[styles.actionBtn, styles.editBtn]}
                        onPress={() => {
                            setIsExpanded(false);
                            onEdit?.();
                        }}
                        activeOpacity={0.7}
                    >
                        <Pencil size={18} color={colors.champagne} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.actionBtn, styles.deleteBtn]}
                        onPress={() => {
                            setIsExpanded(false);
                            onDelete?.();
                        }}
                        activeOpacity={0.7}
                    >
                        <Trash2 size={18} color={colors.danger} />
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        card: {
            backgroundColor: 'transparent',
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
            overflow: 'hidden',
        },
        cardExpanded: {
            backgroundColor: `${colors.surface}50`,
        },
        cardInner: {
            paddingVertical: 12,
            paddingHorizontal: 6,
            gap: 6,
        },
        topRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
        },
        categoryIconWrap: {
            width: 30,
            height: 30,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 10,
        },
        categoryInfo: {
            flex: 1,
            gap: 2,
        },
        titleRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        categoryName: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.textPrimary,
            flexShrink: 1,
        },
        walletText: {
            fontSize: 12,
            color: colors.textSecondary,
            flexShrink: 1,
        },
        period: {
            fontSize: 11,
            color: colors.textSecondary,
        },
        barBackground: {
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.surfaceAlt,
            overflow: 'hidden',
            marginTop: 4,
            marginBottom: 2,
        },
        barFill: {
            height: '100%',
            borderRadius: 3,
        },
        bottomRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        percentText: {
            fontSize: 12,
            fontWeight: '700',
        },
        amountRow: {
            flexDirection: 'row',
            alignItems: 'baseline',
        },
        spentText: {
            fontSize: 13,
            fontWeight: '700',
            color: colors.textPrimary,
        },
        limitText: {
            fontSize: 12,
            color: colors.textSecondary,
            marginLeft: 2,
        },
        statusRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 2,
        },
        statusMessage: {
            fontSize: 11,
            fontWeight: '500',
            flex: 1,
        },
        remainingText: {
            fontSize: 11,
            fontWeight: '600',
            marginLeft: 8,
        },
        actionTray: {
            flexDirection: 'row',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 6,
            paddingBottom: 10,
            paddingTop: 4,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
        },
        actionBtn: {
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
        },
        editBtn: {
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
        },
        deleteBtn: {
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            borderWidth: 1,
            borderColor: 'rgba(239, 68, 68, 0.25)',
        },
    });