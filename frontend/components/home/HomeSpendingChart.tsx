// components/home/HomeSpendingChart.tsx
//
// Compact monthly spending chart for HomeScreen.
// Reuses SpendingLineChart but computes "this month" data only.

import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import SpendingLineChart from '../common/charts/SpendingLineChart';

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export default function HomeSpendingChart() {
    const colors = useTheme();
    const styles = createStyles(colors);
    const navigation = useNavigation();

    const transactions = useBanKoniStore((state) => state.transactions);

    // This month: 4 weekly buckets
    const chartData = useMemo(() => {
        const now = new Date();
        const expenses = transactions.filter((tx) => tx.type === 'DEBIT');

        const labels: string[] = [];
        const values: number[] = [];

        for (let i = 3; i >= 0; i--) {
            const weekEnd = new Date(now);
            weekEnd.setDate(now.getDate() - (i * 7));
            const weekStart = new Date(weekEnd);
            weekStart.setDate(weekEnd.getDate() - 6);
            labels.push(
                `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getDate()}`
            );
            const startStr = weekStart.toISOString().split('T')[0];
            const endStr = weekEnd.toISOString().split('T')[0];
            const weekTotal = expenses
                .filter((tx) => {
                    const txDate = tx.date.split('T')[0];
                    return txDate >= startStr && txDate <= endStr;
                })
                .reduce((sum, tx) => sum + tx.amount, 0);
            values.push(weekTotal);
        }

        return { labels, values };
    }, [transactions]);

    return (
        <View>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Spending This Month</Text>
                <TouchableOpacity onPress={() => navigation.navigate('Analytics' as never)}>
                    <Text style={styles.seeAll}>Details</Text>
                </TouchableOpacity>
            </View>

            <SpendingLineChart
                labels={chartData.labels}
                values={chartData.values}
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
    });
