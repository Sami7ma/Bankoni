// app/(app)/HomeScreen.tsx
// The main dashboard — the first screen users see after logging in.
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import { useRef, useState } from 'react';
import BalanceCards, { BalanceCardsRef } from '../../components/home/BalanceCards';
import AddTransactionModal from '../../components/modals/AddTransactionModal';
import HomeSpendingChart from '../../components/home/HomeSpendingChart';
import HomeBudgetPreview from '../../components/home/HomeBudgetPreview';
import HomeRecentTransactions from '../../components/home/HomeRecentTransactions';
import HomeActionButtons from '../../components/home/HomeActionButtons';
import LogoutButton from '../../components/common/buttons/LogoutButton';


export default function HomeScreen() {
    const user = useBanKoniStore((state) => state.user);
    const totalBalance = useBanKoniStore((state) => state.totalBalance);
    const totalIncome = useBanKoniStore((state) => state.totalIncome);
    const totalExpenses = useBanKoniStore((state) => state.totalExpenses);
    const cardsRef = useRef<BalanceCardsRef>(null);
    const [modalVisible, setModalVisible] = useState(false);
    const [modalType, setModalType] = useState<'CREDIT' | 'DEBIT'>('DEBIT');
    const colors = useTheme();
    const styles = createStyles(colors);

    // Get the first name only — "Samuel Tesfaye" → "Samuel"
    const firstName = user?.name?.split(' ')[0] ?? 'User';

    // UI 
    return (
        <SafeAreaView
            style={styles.safeArea}
            edges={['top', 'left', 'right']}
        >
            <StatusBar style={colors.statusBar} />

            {/* ── FIXED TOP SECTION (doesn't scroll) ── */}
            <View style={{ paddingHorizontal: 10 }}>

                {/* HEADER */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.greeting}>
                            <Text style={styles.userName}> {firstName}</Text>
                        </Text>
                    </View>

                    {/* Actions: Padlock Logout */}
                    <View style={styles.headerActions}>
                        <LogoutButton />
                    </View>
                </View>


                {/* PREMIUM CREDIT CARDS */}
                <BalanceCards
                    ref={cardsRef}
                    userName={user?.name ?? 'User'}
                    totalBalance={totalBalance()}
                    totalIncome={totalIncome()}
                    totalExpenses={totalExpenses()}
                />

                {/* ACTION BUTTONS */}
                <HomeActionButtons
                    onAddExpense={() => {
                        cardsRef.current?.scrollToExpense();
                        setModalType('DEBIT');
                        setModalVisible(true);
                    }}
                    onAddIncome={() => {
                        cardsRef.current?.scrollToIncome();
                        setModalType('CREDIT');
                        setModalVisible(true);
                    }}
                />
            </View>

            {/* ── SCROLLABLE SECTION ── */}
            <ScrollView
                style={styles.scrollView}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}>

                {/* Recent Transactions */}
                <View style={{ marginTop: 10 }}>
                    <HomeRecentTransactions />
                </View>

                {/* Budget this month */}
                <View style={{ marginTop: 10 }}>
                    <HomeBudgetPreview />
                </View>
                {/* Spending this month chart */}
                <View style={{ marginTop: 10 }}>
                    <HomeSpendingChart />
                </View>

            </ScrollView>

            {/* ADD TRANSACTION MODAL */}
            <AddTransactionModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                defaultType={modalType}
            />
        </SafeAreaView>
    );

}

const createStyles = (colors: ReturnType<typeof useTheme>) => StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: colors.background,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 10,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 2,
        marginBottom: 5,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },

    greeting: {
        fontSize: 14,
        color: colors.textSecondary,
        marginBottom: 1
    },
    userName: {
        fontSize: 16,
        fontWeight: 'bold',
        color: colors.textPrimary
    },
});
