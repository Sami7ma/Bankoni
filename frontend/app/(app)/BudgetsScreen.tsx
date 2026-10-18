import React, { useState, useMemo } from "react";

import { Text, View, StyleSheet, FlatList, TouchableOpacity, Alert, } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Plus, NotebookPen } from "lucide-react-native";

import useTheme from "../../hooks/useTheme";
import useBanKoniStore from "../../store/useBanKoniStore";
import BudgetCard from "../../components/home/BudgetCard";
import FloatingActionButton from "../../components/common/buttons/FloatingActionButton";

import EditBudgetModal from '../../components/modals/EditBudgetModal';
import AddBudgetModal from '../../components/modals/AddBudgetModal';
import { Budget } from "../../types/Budget";


export default function BudgetsScreen() {

    // Get current theme
    const colors = useTheme();
    const styles = createStyles(colors);

    // ZUSTAND 

    const budgets = useBanKoniStore((state) => state.budgets);
    const transactions = useBanKoniStore((state) => state.transactions);
    const categories = useBanKoniStore((state) => state.categories);
    const deleteBudget = useBanKoniStore((state) => state.deleteBudget);
    const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

    // LOCAL STATE

    const [modalVisible, setModalVisible] = useState(false);

    // HELPERS
    const getCategoryById = (id: string) =>
        categories.find((cat) => cat.id === id);

    // CALCULATE SPENT PER CATEGORY
    // Calculate how much was spent inside each budget's own start and end dates.
    // for now we use this month only
    const getSpentForBudget = (budget: Budget) => {
        return transactions.filter(tx => {
            if (tx.type !== 'DEBIT') {
                return false;
            }
            if (tx.categoryId !== budget.categoryId) {
                return false;
            }
            const txDate =
                new Date(tx.date)
                    .toISOString()
                    .split('T')[0];
            return (txDate >= budget.startDate && txDate <= budget.endDate);
        }).reduce(
            (total, tx) => total + tx.amount,
            0
        );
    };

    //DELETE HANDLER 
    const handleDelete = (budgetId: string, categoryName: string) => {
        Alert.alert(
            "Delete Budget", // title 
            `Remove the budget for ${categoryName}?`, // message 
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete', style: 'destructive',
                    onPress: () => deleteBudget(budgetId)
                }
            ]
        );
    };

    //SUMMARY 
    const totalBudgeted = budgets.reduce(
        (sum, budget) => sum + budget.limitAmount,
        0
    );

    const totalSpent = budgets.reduce(
        (sum, budget) => sum + (getSpentForBudget(budget) || 0), 0
    );

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
            {/* summary row */}
            {budgets.length > 0 && (
                <View style={styles.summaryRow}>
                    <View style={styles.summaryItem}>
                        <Text style={styles.summaryLabel}>Total Budgeted</Text>
                        <Text style={styles.summaryValue}>
                            ETB {totalBudgeted.toLocaleString()}
                        </Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryItem}>
                        <Text style={styles.summaryLabel}>Total Spent</Text>
                        <Text style={[
                            styles.summaryValue,
                            {
                                color: totalSpent > totalBudgeted
                                    ? colors.danger
                                    : colors.success
                            },
                        ]}>
                            ETB {totalSpent.toLocaleString()}
                        </Text>
                    </View>
                </View>
            )}

            {/* Budger */}
            <FlatList
                data={budgets}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                    <BudgetCard
                        budget={item}
                        category={getCategoryById(item.categoryId)}
                        spent={getSpentForBudget(item) || 0}
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
        paddingTop: 2,
        paddingBottom: 12,
    },

    headerTitle: {
        fontSize: 28,
        fontWeight: "bold",
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
        marginHorizontal: 10,
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 10,
        marginBottom: 5,
        borderWidth: 1,
        borderColor: colors.border,
    },

    summaryItem: {
        flex: 1,
        alignItems: "center",
        gap: 4,
    },

    summaryLabel: {
        fontSize: 12,
        color: colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },

    summaryValue: {
        fontSize: 18,
        fontWeight: "700",
        color: colors.textPrimary,
    },

    summaryDivider: {
        width: 1,
        backgroundColor: colors.border,
        marginHorizontal: 12,
    },

    listContent: {
        paddingHorizontal: 10,
        paddingBottom: 32,
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