// A single row in the transaction list.
// We make this a separate component because it gets reused many times.
// In React, anything you repeat -> extract it into a component.

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Pencil, Trash2 } from 'lucide-react-native';
import { Transaction } from '../../types/Transaction';
import { Category } from '../../types/Category';
import useBanKoniStore from '../../store/useBanKoniStore';
import useTheme from '../../hooks/useTheme';
import CategoryIcon from '../common/icons/CategoryIcon';
import { formatEtb } from '../../utils/format';

// Props = the data and functions this component needs from its parent.
interface TransactionRowProps {
    transaction: Transaction;
    category?: Category;// The category might be undefined if it cannot be found.
    onEdit?: () => void;//
    onDelete?: () => void;
    onPress?: () => void;  // Function that runs when the user taps the row.
}

export default function TransactionRow({
    transaction,
    category,
    onEdit,
    onDelete,
    onPress,
}: TransactionRowProps) {
    // Get the current theme colors.
    const colors = useTheme();

    // Create the styles using the current theme colors.
    const styles = createStyles(colors);

    const wallets = useBanKoniStore((state) => state.wallets);
    const wallet = wallets.find((w) => w.id === transaction.walletId);

    // Expand/collapse the transaction row to show edit and delete buttons.
    const [isExpanded, setIsExpanded] = useState(false);


    // CREDIT = money coming in.
    // DEBIT = money going out.
    const isIncome = transaction.type === 'CREDIT';

    // Format the transaction date so it is easier to read.
    // Example: "Aug 21" instead of a long date string.
    const formattedDate = new Date(transaction.date).toLocaleDateString(
        'en-US',
        {
            month: 'short',
            day: 'numeric',
        }
    );

    // Format the amount as Ethiopian Birr with two decimal places.
    // Example: "ETB 1,500.00"
    const formattedAmount = formatEtb(transaction.amount);

    return (
        <View style={[styles.wrapper, isExpanded && styles.wrapperExpanded]}>
            {/* Main Row */}
            <TouchableOpacity
                style={styles.row}
                onPress={() => {
                    setIsExpanded((prev) => !prev);
                    onPress?.();
                }}
                activeOpacity={0.8}
            >
                <View
                    style={[
                        styles.categoryIconWrap,
                        {
                            backgroundColor: category?.colorKey
                                ? `${category.colorKey}14`
                                : isIncome
                                ? `${colors.success}14`
                                : `${colors.champagne}14`,
                        },
                    ]}
                >
                    <CategoryIcon
                        iconKey={category?.iconKey}
                        color={category?.colorKey ?? (isIncome ? colors.success : colors.champagne)}
                        size={20}
                        flow={category?.flow ?? (isIncome ? 'INCOME' : 'EXPENSE')}
                    />
                </View>

                <View style={styles.info}>
                    <View style={styles.titleRow}>
                        <Text style={styles.categoryName} numberOfLines={1}>
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
                    <Text style={styles.meta} numberOfLines={1}>
                        {transaction.note ? `${transaction.note} • ${formattedDate}` : formattedDate}
                    </Text>
                </View>
                <Text
                    style={[
                        styles.amount,
                        isIncome ? styles.income : styles.expense,
                    ]}
                >
                    {isIncome ? '+' : '-'}
                    {formattedAmount}
                </Text>
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

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        wrapper: {
            backgroundColor: colors.surface,
            borderRadius: 16,
            marginBottom: 8,
            borderWidth: 1,
            borderColor: 'transparent',
            overflow: 'hidden',
        },
        wrapperExpanded: {
            borderColor: colors.border,
        },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 13,
            paddingHorizontal: 14,
        },
        categoryIconWrap: {
            width: 42,
            height: 42,
            borderRadius: 13,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 12,
        },
        info: {
            flex: 1,
            marginRight: 10,
        },
        titleRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginBottom: 3,
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
        meta: {
            fontSize: 12,
            color: colors.textSecondary,
        },
        amount: {
            fontSize: 15,
            fontWeight: '700',
        },
        income: {
            color: colors.success,
        },
        expense: {
            color: colors.danger,
        },
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
