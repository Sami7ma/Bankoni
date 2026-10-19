// components/common/charts/SummaryCards.tsx
//
// Two side-by-side cards showing total Income and total Expenses.
//
// WHY A SEPARATE COMPONENT?
// The summary row is a self-contained UI block — two cards with
// icons, labels, and amounts. Extracting it keeps AnalyticsScreen
// focused on DATA (computing totals) while this component
// handles PRESENTATION (how the cards look).
//
// COULD BE REUSED on a future Profile or Dashboard screen.

import { View, Text, StyleSheet } from 'react-native';
import { TrendingUp, TrendingDown } from 'lucide-react-native';
import useTheme from '../../../hooks/useTheme';

// ── PROPS ────────────────────────────────────────────────
// The parent calculates the totals from Zustand and passes them in.
// This component has no idea where the numbers come from — it just shows them.
interface SummaryCardsProps {
    totalIncome: number;
    totalExpenses: number;
}

export default function SummaryCards({ totalIncome, totalExpenses }: SummaryCardsProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    return (
        <View style={styles.row}>
            {/* INCOME CARD */}
            <View style={styles.card}>
                <View style={styles.iconRow}>
                    <TrendingUp size={18} color={colors.success} />
                    <Text style={styles.label}>Income</Text>
                </View>
                <Text style={[styles.amount, { color: colors.success }]}>
                    ETB {totalIncome.toLocaleString()}
                </Text>
            </View>

            {/* EXPENSES CARD */}
            <View style={styles.card}>
                <View style={styles.iconRow}>
                    <TrendingDown size={18} color={colors.danger} />
                    <Text style={styles.label}>Expenses</Text>
                </View>
                <Text style={[styles.amount, { color: colors.danger }]}>
                    ETB {totalExpenses.toLocaleString()}
                </Text>
            </View>
        </View>
    );
}

// ── STYLES ───────────────────────────────────────────────
const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        row: {
            flexDirection: 'row',
            gap: 12,
        },
        card: {
            flex: 1,
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 16,
            gap: 10,
            borderWidth: 1,
            borderColor: colors.border,
        },
        iconRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        label: {
            fontSize: 13,
            fontWeight: '600',
            color: colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
        },
        amount: {
            fontSize: 20,
            fontWeight: '700',
        },
    });
