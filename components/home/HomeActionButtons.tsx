// components/home/HomeActionButtons.tsx
//
// "Add Expense" and "Add Income" action buttons for the HomeScreen.
// Self-contained — manages its own press state.

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Plus } from 'lucide-react-native';
import useTheme from '../../hooks/useTheme';

interface HomeActionButtonsProps {
    onAddExpense: () => void;
    onAddIncome: () => void;
}

export default function HomeActionButtons({
    onAddExpense,
    onAddIncome,
}: HomeActionButtonsProps) {
    const colors = useTheme();
    const styles = createStyles(colors);
    const [pressedAction, setPressedAction] = useState<'DEBIT' | 'CREDIT' | null>(null);

    return (
        <View style={styles.actionsRow}>
            <TouchableOpacity
                style={[
                    styles.actionButton,
                    {
                        borderColor:
                            pressedAction === 'DEBIT'
                                ? colors.danger
                                : colors.danger + '45',
                        backgroundColor:
                            pressedAction === 'DEBIT'
                                ? colors.danger + '10'
                                : 'transparent',
                    },
                ]}
                onPress={onAddExpense}
                onPressIn={() => setPressedAction('DEBIT')}
                onPressOut={() => setPressedAction(null)}
                activeOpacity={0.9}
            >
                <Plus size={18} color={colors.danger} />
                <Text style={styles.expenseText}>Add Expense</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={[
                    styles.actionButton,
                    {
                        borderColor:
                            pressedAction === 'CREDIT'
                                ? colors.success
                                : colors.success + '45',
                        backgroundColor:
                            pressedAction === 'CREDIT'
                                ? colors.success + '10'
                                : 'transparent',
                    },
                ]}
                onPress={() => {
                    onAddIncome();
                    setPressedAction(null);
                }}
                onPressIn={() => setPressedAction('CREDIT')}
                onPressOut={() => setPressedAction(null)}
                activeOpacity={0.9}
            >
                <Plus size={18} color={colors.success} />
                <Text style={styles.incomeText}>Add Income</Text>
            </TouchableOpacity>
        </View>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        actionsRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            paddingVertical: 2,
        },
        actionButton: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            borderRadius: 14,
            paddingVertical: 12,
            paddingHorizontal: 16,
        },
        expenseText: {
            color: colors.danger,
            fontSize: 14,
            fontWeight: '700',
            letterSpacing: 0.2,
        },
        incomeText: {
            color: colors.success,
            fontSize: 14,
            fontWeight: '700',
            letterSpacing: 0.2,
        },
    });
