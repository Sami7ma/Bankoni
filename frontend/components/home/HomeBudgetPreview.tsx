// components/home/HomeBudgetPreview.tsx
// Compact budget preview for the HomeScreen.
// Shows up to 4 budgets as individual cards matching TransactionRow style.
// components/home/HomeBudgetPreview.tsx
import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Pencil, Trash2 } from 'lucide-react-native';
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import EditBudgetModal from '../modals/EditBudgetModal';
import { Budget } from '../../types/Budget';
import CategoryIcon from '../common/icons/CategoryIcon';

export default function HomeBudgetPreview() {
    const colors = useTheme();
    const styles = createStyles(colors);
    const navigation = useNavigation();

    const budgets = useBanKoniStore((state) => state.budgets);
    const transactions = useBanKoniStore((state) => state.transactions);
    const categories = useBanKoniStore((state) => state.categories);
    const wallets = useBanKoniStore((state) => state.wallets);
    const deleteBudget = useBanKoniStore((state) => state.deleteBudget);

    const [expandedBudgetId, setExpandedBudgetId] = useState<string | null>(null);
    const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

    const getCategoryById = (id: string) =>
        categories.find((cat) => cat.id === id);

    const getCategoryName = (id: string) =>
        getCategoryById(id)?.name ?? 'Unknown';

    const getSpent = (categoryId: string, walletId?: string | null) =>
        transactions
            .filter((tx) => {
                if (tx.type !== 'DEBIT' || tx.categoryId !== categoryId) return false;
                if (walletId && tx.walletId !== walletId) return false;
                return true;
            })
            .reduce((sum, tx) => sum + tx.amount, 0);

    const previewBudgets = budgets
        .map((b) => {
            const spent = getSpent(b.categoryId, b.walletId);
            const pct = b.limitAmount > 0 ? spent / b.limitAmount : 0;
            const wallet = wallets.find((w) => w.id === b.walletId);
            return {
                ...b,
                spent,
                pct,
                name: getCategoryName(b.categoryId),
                walletName: wallet?.name,
            };
        })
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 4);

    const getBarColor = (pct: number) => {
        if (pct >= 0.8) return colors.danger;
        if (pct >= 0.5) return '#F5A623';
        return colors.success;
    };

    const handleDelete = (budget: Budget, name: string) => {
        Alert.alert(
            'Delete Budget',
            `Remove the budget for ${name}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => deleteBudget(budget.id),
                },
            ]
        );
    };

    if (previewBudgets.length === 0) return null;

    return (
        <View>
            {/* Section Header */}
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Budgets This Month</Text>
                <TouchableOpacity onPress={() => navigation.navigate('Budgets' as never)}>
                    <Text style={styles.seeAll}>See all</Text>
                </TouchableOpacity>
            </View>

            {/* Individual Budget Cards */}
            {previewBudgets.map((item) => {
                const barColor = getBarColor(item.pct);
                const barWidth = Math.min(item.pct, 1) * 100;
                const isExpanded = expandedBudgetId === item.id;

                return (
                    <View key={item.id} style={[styles.row, isExpanded && styles.rowExpanded]}>
                        <TouchableOpacity
                            onPress={() => setExpandedBudgetId((curr) => (curr === item.id ? null : item.id))}
                            activeOpacity={0.8}
                        >
                            <View style={styles.rowTop}>
                                {(() => {
                                    const cat = getCategoryById(item.categoryId);
                                    return (
                                        <View
                                            style={[
                                                styles.categoryIconWrap,
                                                {
                                                    backgroundColor: cat?.colorKey
                                                        ? `${cat.colorKey}14`
                                                        : `${colors.champagne}14`,
                                                },
                                            ]}
                                        >
                                            <CategoryIcon
                                                iconKey={cat?.iconKey}
                                                color={cat?.colorKey ?? colors.champagne}
                                                size={18}
                                                flow={cat?.flow ?? 'EXPENSE'}
                                            />
                                        </View>
                                    );
                                })()}
                                <View style={styles.titleRow}>
                                    <Text style={styles.budgetName} numberOfLines={1}>
                                        {item.name}
                                    </Text>
                                    {item.walletName ? (
                                        <View style={styles.walletBadge}>
                                            <Text style={styles.walletBadgeText} numberOfLines={1}>
                                                {item.walletName}
                                            </Text>
                                        </View>
                                    ) : null}
                                </View>
                                <Text style={[styles.budgetPct, { color: barColor }]}>
                                    {Math.round(item.pct * 100)}%
                                </Text>
                            </View>

                            <View style={styles.barTrack}>
                                <View
                                    style={[
                                        styles.barFill,
                                        { width: `${barWidth}%`, backgroundColor: barColor },
                                    ]}
                                />
                            </View>

                            <View style={styles.rowBottom}>
                                <Text style={styles.spentText}>
                                    ETB {item.spent.toLocaleString()}
                                </Text>
                                <Text style={styles.limitText}>
                                    / ETB {item.limitAmount.toLocaleString()}
                                </Text>
                            </View>
                        </TouchableOpacity>

                        {/* Popout Edit & Delete only icons */}
                        {isExpanded && (
                            <View style={styles.actionTray}>
                                <TouchableOpacity
                                    style={[styles.actionBtn, styles.editBtn]}
                                    onPress={() => {
                                        setExpandedBudgetId(null);
                                        setEditingBudget(item);
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <Pencil size={18} color={colors.champagne} />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.actionBtn, styles.deleteBtn]}
                                    onPress={() => {
                                        setExpandedBudgetId(null);
                                        handleDelete(item, item.name);
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <Trash2 size={18} color={colors.danger} />
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>
                );
            })}

            {/* Working Edit Modal */}
            <EditBudgetModal
                visible={!!editingBudget}
                budget={editingBudget}
                onClose={() => setEditingBudget(null)}
            />
        </View>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        sectionHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
        },
        sectionTitle: {
            fontSize: 18,
            fontWeight: 'bold',
            color: colors.textPrimary,
        },
        seeAll: {
            fontSize: 14,
            color: colors.champagne,
            fontWeight: '500',
        },
        row: {
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 14,
            marginBottom: 8,
            borderWidth: 1,
            borderColor: 'transparent',
        },
        rowExpanded: {
            borderColor: colors.border,
        },
        rowTop: {
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 8,
        },
        categoryIconWrap: {
            width: 38,
            height: 38,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 10,
        },
        titleRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            flex: 1,
            marginRight: 8,
        },
        budgetName: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textPrimary,
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
        budgetPct: {
            fontSize: 13,
            fontWeight: '700',
        },
        barTrack: {
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.surfaceAlt,
            overflow: 'hidden',
            marginBottom: 8,
        },
        barFill: {
            height: '100%',
            borderRadius: 3,
        },
        rowBottom: {
            flexDirection: 'row',
            alignItems: 'center',
        },
        spentText: {
            fontSize: 13,
            fontWeight: '700',
            color: colors.textPrimary,
        },
        limitText: {
            fontSize: 13,
            color: colors.textSecondary,
            marginLeft: 2,
        },
        actionTray: {
            flexDirection: 'row',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 12,
            marginTop: 10,
            paddingTop: 8,
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
