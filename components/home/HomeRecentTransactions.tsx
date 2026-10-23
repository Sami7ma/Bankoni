// components/home/HomeRecentTransactions.tsx
//
// Self-contained "Recent Transactions" section for the HomeScreen.
// Pulls its own data from the store, shows the last 7 transactions.

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import TransactionRow from './TransactionRow';
import EditTransactionModal from '../modals/EditTransactionModal';
import { Transaction } from '../../types/Transaction';

export default function HomeRecentTransactions() {
    const colors = useTheme();
    const styles = createStyles(colors);
    const navigation = useNavigation();
    const transactions = useBanKoniStore((state) => state.transactions);
    const categories = useBanKoniStore((state) => state.categories);
    const deleteTransaction = useBanKoniStore((state) => state.deleteTransaction);
    const [editingTx, setEditingTx] = useState<Transaction | null>(null);
    const recentTransactions = transactions.slice(0, 7);
    const getCategoryById = (id: string) =>
        categories.find((cat) => cat.id === id);
    const handleDelete = (tx: Transaction) => {
        const catName = getCategoryById(tx.categoryId)?.name ?? 'Transaction';
        Alert.alert(
            'Delete Transaction',
            `Remove this ${catName} transaction?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => deleteTransaction(tx.id),
                },
            ]
        );
    };

    return (
        <View>
            {/* Section Header */}
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Recent Transactions</Text>
                <TouchableOpacity onPress={() => (navigation.navigate as any)('Ledger', { initialTab: 'transactions' })}>
                    <Text style={styles.seeAll}>See all</Text>
                </TouchableOpacity>
            </View>
            {/* Transaction List */}
            {recentTransactions.length === 0 ? (
                <View style={styles.emptyState}>
                    <Text style={styles.emptyIcon}>💳</Text>
                    <Text style={styles.emptyTitle}>No transactions yet</Text>
                    <Text style={styles.emptySubtitle}>
                        Tap "Add Expense" to log your first one
                    </Text>
                </View>
            ) : (
                recentTransactions.map((transaction) => (
                    <TransactionRow
                        key={transaction.id}
                        transaction={transaction}
                        category={getCategoryById(transaction.categoryId)}
                        onEdit={() => setEditingTx(transaction)}
                        onDelete={() => handleDelete(transaction)}
                    />
                ))
            )}
            {/* Working Edit Modal */}
            <EditTransactionModal
                visible={!!editingTx}
                transaction={editingTx}
                onClose={() => setEditingTx(null)}
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
        emptyState: {
            alignItems: 'center',
            paddingVertical: 40,
            gap: 8,
        },
        emptyIcon: {
            fontSize: 40,
            marginBottom: 4,
        },
        emptyTitle: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        emptySubtitle: {
            fontSize: 13,
            color: colors.textSecondary,
        },
    });
