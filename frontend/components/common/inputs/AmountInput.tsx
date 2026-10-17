// components/common/AmountInput.tsx
//
// A money input field with "ETB" prefix.
// Has TWO variants (modes):
//
// 'large' → Used in AddTransactionModal
//   Big centered text, no border, prominent display.
//   Looks like:
//       ETB
//       0.00     (huge text, centered)
//
// 'compact' → Used in AddBudgetModal
//   Row layout with border, inside a card.
//   Looks like:
//   ┌─────────────────────┐
//   │ ETB   0.00          │
//   └─────────────────────┘
// Both modals need a money input. By extracting it,
// we guarantee the same keyboard type, placeholder,
// and styling logic in both places.

import React from 'react';
import { View, Text, TextInput, StyleSheet, Dimensions } from 'react-native';
import useTheme from '../../../hooks/useTheme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface AmountInputProps {
    value: string;
    onChangeText: (text: string) => void;
    variant?: 'large' | 'compact';   // defaults to 'large'
    autoFocus?: boolean;              // should it auto-open keyboard?
    currency?: string;                // defaults to 'ETB'
}

export default function AmountInput({
    value,
    onChangeText,
    variant = 'large',     // default to large if not specified
    autoFocus = false,
    currency = 'ETB',
}: AmountInputProps) {

    const colors = useTheme();
    const styles = createStyles(colors);

    // COMPACT VARIANT — row with border (used in Budget modal)
    if (variant === 'compact') {
        return (
            <View style={styles.compactRow}>
                <Text style={styles.compactCurrency}>{currency}</Text>
                <TextInput
                    style={styles.compactInput}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"    // only show number keys + decimal
                    autoFocus={autoFocus}
                />
            </View>
        );
    }

    // LARGE VARIANT — centered big display (used in Transaction modal)
    return (
        <View style={styles.largeContainer}>
            <Text style={styles.largeCurrency}>{currency}</Text>
            <TextInput
                style={styles.largeInput}
                value={value}
                onChangeText={onChangeText}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted + '70'}
                keyboardType="decimal-pad"
                autoFocus={autoFocus}
            />
        </View>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        // ── LARGE VARIANT (Transaction modal) ────────────────
        largeContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 100,
            gap: 8,
        },
        largeCurrency: {
            fontSize: 17,
            fontWeight: '500',
            color: colors.textSecondary,
            marginTop: 8,
        },
        largeInput: {
            fontSize: 46,
            fontWeight: '700',
            color: colors.champagne,
            minWidth: SCREEN_WIDTH * 0.45,
            maxWidth: SCREEN_WIDTH * 0.62,
            textAlign: 'center',
            paddingVertical: 0,
        },

        // ── COMPACT VARIANT (Budget modal) ───────────────────
        compactRow: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surfaceAlt,
            borderRadius: 14,
            paddingHorizontal: 16,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 8,
        },
        compactCurrency: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.textSecondary,
        },
        compactInput: {
            flex: 1,
            fontSize: 28,
            fontWeight: '700',
            color: colors.champagne,
            paddingVertical: 14,
        },
    });
