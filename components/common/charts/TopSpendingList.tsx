// components/common/charts/TopSpendingList.tsx
//
// A list of spending categories, sorted by highest spend.
// Each row shows: color dot, category name, amount, and percentage.
//
// WHY A SEPARATE COMPONENT?
// This is a pure presentation component — it receives pre-computed data
// and just renders it. AnalyticsScreen handles the grouping, sorting,
// and percentage math. This component handles the visual layout.
//
// COULD BE REUSED on a budget breakdown screen or monthly report.

import { View, Text, StyleSheet } from 'react-native';
import useTheme from '../../../hooks/useTheme';
import { formatEtb } from '../../../utils/format';

// ── TYPES ────────────────────────────────────────────────
// Each item in the list represents one category's spending.
export interface SpendingCategory {
    categoryId: string;
    name: string;
    amount: number;
    color: string;       // hex color for the dot
    percentage: string;  // pre-computed like "35.2"
}

interface TopSpendingListProps {
    data: SpendingCategory[];
}

export default function TopSpendingList({ data }: TopSpendingListProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    return (
        <View style={styles.card}>
            {data.map((cat, index) => (
                <View
                    key={cat.categoryId}
                    style={[
                        styles.row,
                        // Add a bottom border on every row except the last one
                        index < data.length - 1 && styles.rowBorder,
                    ]}
                >
                    {/* LEFT SIDE: color dot + category name */}
                    <View style={styles.left}>
                        <View
                            style={[
                                styles.colorDot,
                                { backgroundColor: cat.color },
                            ]}
                        />
                        <Text style={styles.name}>{cat.name}</Text>
                    </View>

                    {/* RIGHT SIDE: amount + percentage */}
                    <View style={styles.right}>
                        <Text style={styles.amount}>
                            {formatEtb(cat.amount)}
                        </Text>
                        <Text style={styles.percent}>
                            {cat.percentage}%
                        </Text>
                    </View>
                </View>
            ))}

            {/* EMPTY STATE — no expenses at all */}
            {data.length === 0 && (
                <Text style={styles.noDataText}>
                    No spending data for this period.
                </Text>
            )}
        </View>
    );
}

// ── STYLES ───────────────────────────────────────────────
const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        card: {
            backgroundColor: 'transparent',
            overflow: 'hidden',
        },
        row: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 13,
            paddingHorizontal: 2,
        },
        rowBorder: {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
        },
        left: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
        },
        colorDot: {
            width: 12,
            height: 12,
            borderRadius: 6,
        },
        name: {
            fontSize: 15,
            fontWeight: '500',
            color: colors.textPrimary,
        },
        right: {
            alignItems: 'flex-end',
            gap: 2,
        },
        amount: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        percent: {
            fontSize: 12,
            color: colors.textSecondary,
        },
        noDataText: {
            padding: 24,
            fontSize: 14,
            color: colors.textSecondary,
            textAlign: 'center',
        },
    });
