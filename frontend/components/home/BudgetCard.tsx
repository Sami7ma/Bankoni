// A single budget card in the budget list.
//
// We make this a separate component because each budget
// needs to display the same layout and behavior.
//
// The card shows:
// - Category name and budget period
// - Budget start and end dates
// - Amount spent and budget limit
// - Progress bar
// - Percentage used
// - Remaining amount
// - Remove budget action
import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Pencil, Trash2 } from 'lucide-react-native';
import { Budget } from '../../types/Budget';
import { Category } from '../../types/Category';
import useBanKoniStore from '../../store/useBanKoniStore';
import useTheme from '../../hooks/useTheme';
import CategoryIcon from '../common/icons/CategoryIcon';


// Props = the data and functions this component needs from its parent.
interface BudgetCardProps {
    budget: Budget;
    category: Category | undefined;
    spent: number;
    onEdit?: () => void;
    onDelete?: () => void;
    onPress?: () => void;
}

export default function BudgetCard({
    budget,
    category,
    spent,
    onEdit,
    onDelete,
    onPress,
}: BudgetCardProps) {

    // Get the current theme colors.
    const colors = useTheme();

    // Create the styles using the current theme colors.
    const styles = createStyles(colors);

    const wallets = useBanKoniStore((state) => state.wallets);
    const wallet = wallets.find((w) => w.id === budget.walletId);

    // Manage local state for expanded / collapsed card
    const [isExpanded, setIsExpanded] = useState(false);

    // Calculate how much of the budget has been used.
    //
    // Example:
    // spent = 320
    // limit = 500
    // percentage = 0.64 = 64%
    const percentage =
        budget.limitAmount > 0
            ? spent / budget.limitAmount
            : 0;

    // Limit the progress bar to a maximum of 100%.
    //
    // The percentage itself can still be greater than 100%,
    // but the visual bar should never grow outside its container.
    const barWidth = Math.min(percentage, 1) * 100;

    // Calculate how much money is still available.
    //
    // A negative value means the user has gone over the budget.
    const remaining = budget.limitAmount - spent;

    // Choose the progress color based on how much
    // of the budget has been used.
    //
    // Under 50% -> green
    // 50% - 79% -> yellow
    // 80%+      -> red
    const getBarColor = () => {
        if (percentage >= 0.8) {
            return colors.danger;
        }

        if (percentage >= 0.5) {
            return '#F5A623';
        }

        return colors.success;
    };

    const barColor = getBarColor();

    // Format money as Ethiopian Birr with two decimal places.
    //
    // Example:
    // 1500 -> ETB 1,500.00
    const formatMoney = (amount: number) => {
        return `ETB ${Math.abs(amount).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })}`;
    };

    // Format a date for the budget period.
    //
    // Example:
    // 2026-08-21 -> Aug 21
    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
        });
    };

    // Display the complete budget period.
    //
    // Example:
    // Weekly · Aug 21 – Aug 27
    const periodText =
        `${formatDate(budget.startDate)} – ${formatDate(budget.endDate)}`;

    return (
        <View style={styles.card}>
            {/* The main card content wrapped in a touchable area to expand it */}
            <TouchableOpacity
                style={styles.cardInner}
                onPress={() => {
                    setIsExpanded((prev) => !prev);
                    onPress?.();
                }}
                activeOpacity={0.8}
            >
                {/* Top row: category information */}
                <View style={styles.topRow}>
                    <View
                        style={[
                            styles.categoryIconWrap,
                            {
                                backgroundColor: category?.colorKey
                                    ? `${category.colorKey}14`
                                    : `${colors.champagne}14`,
                            },
                        ]}
                    >
                        <CategoryIcon
                            iconKey={category?.iconKey}
                            color={category?.colorKey ?? colors.champagne}
                            size={20}
                            flow={category?.flow ?? 'EXPENSE'}
                        />
                    </View>
                    <View style={styles.categoryInfo}>
                        <View style={styles.titleRow}>
                            <Text
                                style={styles.categoryName}
                                numberOfLines={1}
                            >
                                {category?.name ?? 'Uncategorized'}
                            </Text>
                            {wallet ? (
                                <View style={styles.walletBadge}>
                                    <Text style={styles.walletBadgeText} numberOfLines={1}>
                                        {wallet.name}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                        <Text
                            style={styles.period}
                            numberOfLines={1}
                        >
                            {periodText}
                        </Text>
                    </View>
                </View>
                {/* Amount row: amount spent / budget limit */}
                <View style={styles.amountRow}>
                    <Text style={styles.spentText}>
                        {formatMoney(spent)}
                    </Text>
                    <Text style={styles.limitText}>
                        / {formatMoney(budget.limitAmount)}
                    </Text>
                </View>
                {/* Progress bar showing how much of the budget has been used. */}
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
                {/* Bottom row: percentage used + remaining budget */}
                <View style={styles.bottomRow}>
                    <Text
                        style={[
                            styles.percentText,
                            { color: barColor },
                        ]}
                    >
                        {Math.round(percentage * 100)}%
                    </Text>
                    <Text style={styles.remainingText}>
                        {remaining >= 0
                            ? `${formatMoney(remaining)} left`
                            : `${formatMoney(Math.abs(remaining))} over!`}
                    </Text>
                </View>
            </TouchableOpacity>
            {/* Popout Edit & Delete Icons Under Row (No words) */}
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

const createStyles = (
    colors: ReturnType<typeof useTheme>
) => StyleSheet.create({

    card: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden', // Ensures the drawer doesn't spill out
    },
    cardInner: {
        padding: 14,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    categoryIconWrap: {
        width: 42,
        height: 42,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    categoryInfo: {
        flex: 1,
        gap: 3,
        paddingRight: 8,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    categoryName: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.textPrimary,
        flexShrink: 1,
    },
    walletBadge: {
        paddingHorizontal: 6,
        paddingVertical: 1.5,
        borderRadius: 6,
        backgroundColor: colors.surfaceAlt,
        borderWidth: 1,
        borderColor: colors.border,
    },
    walletBadgeText: {
        fontSize: 10,
        fontWeight: '600',
        color: colors.champagne,
        letterSpacing: 0.3,
    },
    period: {
        fontSize: 12,
        color: colors.textSecondary,
        letterSpacing: 0.2,
    },
    amountRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: 12,
    },
    spentText: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.textPrimary,
    },
    limitText: {
        fontSize: 13,
        color: colors.textSecondary,
        marginLeft: 4,
    },
    barBackground: {
        height: 7,
        borderRadius: 4,
        backgroundColor: colors.surfaceAlt,
        overflow: 'hidden',
        marginBottom: 10,
    },
    barFill: {
        height: '100%',
        borderRadius: 4,
    },
    bottomRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    percentText: {
        fontSize: 13,
        fontWeight: '700',
    },
    remainingText: {
        fontSize: 12,
        color: colors.textSecondary,
    },
    // --- Expanding Drawer Styles ---
    actionTray: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 12,
        paddingBottom: 10,
        paddingTop: 4,
        borderTopWidth: 1,
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