import { useState, useMemo } from "react";

import { Text, View, StyleSheet, FlatList, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { NotebookPen } from "lucide-react-native";

import useTheme from "../../hooks/useTheme";
import useBanKoniStore from "../../store/useBanKoniStore";
import BudgetCard from "../../components/home/BudgetCard";
import FloatingActionButton from "../../components/common/buttons/FloatingActionButton";

import EditBudgetModal from '../../components/modals/EditBudgetModal';
import AddBudgetModal from '../../components/modals/AddBudgetModal';
import { Budget } from "../../types/Budget";
import { getTodayEthiopianDateString } from "../../utils/date";
import {
    filterEligibleTransactions,
    calculateBudgetMetrics,
    BudgetMetrics,
} from "../../utils/financial";
import { formatEtb } from "../../utils/format";


export default function BudgetsScreen() {

    // Get current theme
    const colors = useTheme();
    const styles = createStyles(colors);

    // ZUSTAND 

    const budgets = useBanKoniStore((state) => state.budgets);
    const transactions = useBanKoniStore((state) => state.transactions);
    const wallets = useBanKoniStore((state) => state.wallets);
    const categories = useBanKoniStore((state) => state.categories);
    const deleteBudget = useBanKoniStore((state) => state.deleteBudget);
    const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

    // LOCAL STATE
    const [modalVisible, setModalVisible] = useState(false);

    // Current Ethiopian local calendar date (EAT UTC+3)
    const todayStr = useMemo(() => getTodayEthiopianDateString(), []);

    // Filter cleared transactions from active wallets
    const eligibleTransactions = useMemo(
        () => filterEligibleTransactions(transactions, wallets),
        [transactions, wallets]
    );

    // Map each budget to its calculated metrics
    const budgetMetricsMap = useMemo(() => {
        const map = new Map<string, BudgetMetrics>();
        for (const b of budgets) {
            map.set(b.id, calculateBudgetMetrics(b, eligibleTransactions, todayStr));
        }
        return map;
    }, [budgets, eligibleTransactions, todayStr]);

    // HELPERS
    const getCategoryById = (id: string) =>
        categories.find((cat) => cat.id === id);

    // DELETE HANDLER 
    const handleDelete = (budgetId: string, categoryName: string) => {
        Alert.alert(
            "Delete Budget",
            `Remove the budget for ${categoryName}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => deleteBudget(budgetId),
                },
            ]
        );
    };

    // SUMMARY METRICS
    const totalBudgeted = useMemo(
        () => budgets.reduce((sum, budget) => sum + budget.limitAmount, 0),
        [budgets]
    );

    const totalSpent = useMemo(
        () =>
            budgets.reduce((sum, budget) => {
                const m = budgetMetricsMap.get(budget.id);
                return sum + (m?.spent ?? 0);
            }, 0),
        [budgets, budgetMetricsMap]
    );

    const totalRemaining = totalBudgeted - totalSpent;

    // UI 
    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar style={colors.statusBar} />
            <View style={styles.header}>
                <View>
                    <Text style={styles.headerTitle}>Budgets</Text>
                    <Text style={styles.headerSubtitle}>
                        {budgets.length} active budget{budgets.length !== 1 ? 's' : ''}
                    </Text>
                </View>
                {/* + button — uses reusable FloatingActionButton */}
                <FloatingActionButton
                    onPress={() => setModalVisible(true)}
                />
            </View>

            {/* SUMMARY ROW: Budgeted | Spent | Remaining */}
            {budgets.length > 0 && (
                <View style={styles.summaryRow}>
                    <View style={styles.summaryItem}>
                        <Text style={styles.summaryLabel}>Budgeted</Text>
                        <Text style={styles.summaryValue}>
                            {formatEtb(totalBudgeted, { decimals: 0 })}
                        </Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryItem}>
                        <Text style={styles.summaryLabel}>Spent</Text>
                        <Text
                            style={[
                                styles.summaryValue,
                                {
                                    color:
                                        totalSpent > totalBudgeted
                                            ? colors.danger
                                            : colors.textPrimary,
                                },
                            ]}
                        >
                            {formatEtb(totalSpent, { decimals: 0 })}
                        </Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryItem}>
                        <Text style={styles.summaryLabel}>Remaining</Text>
                        <Text
                            style={[
                                styles.summaryValue,
                                {
                                    color:
                                        totalRemaining >= 0
                                            ? colors.success
                                            : colors.danger,
                                },
                            ]}
                        >
                            {formatEtb(totalRemaining, { decimals: 0 })}
                        </Text>
                    </View>
                </View>
            )}

            {/* BUDGETS LIST */}
            <FlatList
                data={budgets}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                    <BudgetCard
                        budget={item}
                        category={getCategoryById(item.categoryId)}
                        metrics={budgetMetricsMap.get(item.id)}
                        onEdit={() => setEditingBudget(item)}
                        onDelete={() =>
                            handleDelete(
                                item.id,
                                getCategoryById(item.categoryId)?.name ?? 'Unknown'
                            )
                        }
                    />
                )}

                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <NotebookPen
                            size={56}
                            color={colors.champagne}
                            style={styles.emptyIcon}
                            strokeWidth={1.5}
                        />
                        <Text style={styles.emptyTitle}>No budgets yet</Text>
                        <Text style={styles.emptySubtitle}>
                            Tap + to set your first spending limit
                        </Text>
                    </View>
                }
            />
            <AddBudgetModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
            />
            <EditBudgetModal
                visible={!!editingBudget}
                budget={editingBudget}
                onClose={() => setEditingBudget(null)}
            />

        </SafeAreaView>

    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) => StyleSheet.create({

    safeArea: {
        flex: 1,
        backgroundColor: colors.background,
    },

    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingTop: Platform.OS === 'ios' ? 14 : 8,
        paddingBottom: 10,
    },

    headerTitle: {
        fontSize: 28,
        fontWeight: "700",
        letterSpacing: 0.3,
        color: colors.textPrimary,
    },

    headerSubtitle: {
        fontSize: 14,
        color: colors.textSecondary,
        marginTop: 2,
    },

    // addButton REMOVED
    // → now handled by FloatingActionButton component

    summaryRow: {
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: 10,
        backgroundColor: "transparent",
        paddingVertical: 10,
        paddingHorizontal: 2,
        marginBottom: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },

    summaryItem: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
    },

    summaryLabel: {
        fontSize: 11,
        color: colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.8,
        fontWeight: "600",
        textAlign: "center",
    },

    summaryValue: {
        fontSize: 20,
        fontWeight: "700",
        color: colors.textPrimary,
        marginTop: 2,
        textAlign: "center",
    },

    summaryDivider: {
        width: 1,
        height: 32,
        alignSelf: "center",
        backgroundColor: colors.border,
        marginHorizontal: 12,
    },

    listContent: {
        paddingHorizontal: 10,
        paddingBottom: 90,
    },

    emptyState: {
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 100,
        gap: 8,
    },

    emptyIcon: {
        marginBottom: 8,
        color: colors.champagne,
    },

    emptyTitle: {
        fontSize: 16,
        fontWeight: "600",
        color: colors.textPrimary,
    },

    emptySubtitle: {
        fontSize: 14,
        color: colors.textSecondary,
        textAlign: "center",
    },
});