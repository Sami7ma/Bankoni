// full list of all trnascsin wiht serach and filering
// this is the 'Trasncion tab in the bootm in th enavigain 

import { useState, useMemo } from 'react';
// use memo caches an expensiv calculain it only recalcualte when its dependics change we'll 
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CalendarDays, CreditCard, Plus, Search, X } from 'lucide-react-native';
import { Calendar } from 'react-native-calendars';
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import TransactionRow from '../../components/home/TransactionRow';
import { FlatList } from 'react-native';
import AddTransactionModal from '../../components/modals/AddTransactionModal';
import EditTransactionModal from '../../components/modals/EditTransactionModal';
import { Transaction } from '../../types/Transaction';

export default function TransactionScreen() {
    // theme
    const colors = useTheme();
    const styles = createStyles(colors);

    // Zustand
    const transactions = useBanKoniStore((state) => state.transactions);
    const categories = useBanKoniStore((state) => state.categories);
    const deleteTransaction = useBanKoniStore((state) => state.deleteTransaction);
    const [editingTx, setEditingTx] = useState<Transaction | null>(null);

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


    // Locat state
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'ALL' | 'CREDIT' | 'DEBIT'>('ALL');
    const [modalVisible, setModalVisible] = useState(false);
    const [modalType] = useState<'CREDIT' | 'DEBIT'>('DEBIT');
    // calnder visibility 
    const [calendarVisible, setCalendarVisible] = useState(false);
    // show transarin form every dates
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    // date formatter
    const formatSelectedDate = (date: string) => {
        const parsedDate = new Date(`${date}T00:00:00`);
        return parsedDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    // helper to find category bu ID like the ones in home screen
    const getCategoryById = (id: string) => categories.find((cat) => cat.id === id);


    // filtered + grouped transactions
    // we use useMemo her = "only calcylate when transcaion, searchQuer,
    // or filter state changes"
    const filteredTransactions = useMemo(() => {
        // step 1: Fileter by type (ALL/CREDIT/DEBIT)
        let filtered = transactions;
        if (filter !== 'ALL') {
            filtered = filtered.filter((tx) => tx.type === filter);
        }
        // step 2: filter by search queyr (match category name or note)
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter((tx) => {
                const category = getCategoryById(tx.categoryId);
                const categoryMatch = category?.name.toLocaleLowerCase().includes(query);
                const noteMatch = tx.note?.toLocaleLowerCase().includes(query);
                return categoryMatch || noteMatch;
            });
        }
        // Step 3: Group by date
        if (selectedDate) {
            filtered = filtered.filter((tx) => {
                const transactionDate = new Date(tx.date);
                const transactionDateKey = transactionDate.toISOString().split('T')[0];
                return transactionDateKey === selectedDate;
            });
        }

        // step 4 sort
        // newwest transacion first
        filtered.sort((a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        return filtered
    }
        , [transactions, categories, searchQuery, filter, selectedDate]
    );

    // caldednaer markder Date
    const markedDates = selectedDate ? {
        [selectedDate]: {
            selected: true,
            selectedColor: colors.champagne,
            selectedTextColor: colors.background,
        },
    }
        : {};
    //  UI

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar style={colors.statusBar} />
            {/* header  */}
            <View style={styles.header}>
                <View style={styles.headerText}>
                    <Text style={styles.headerTitle}>
                        Transactions
                    </Text>

                    <Text style={styles.headerSubtitle}>
                        Search and explore your transactions
                    </Text>
                </View>

                <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => setModalVisible(true)}
                    activeOpacity={0.8}
                >
                    <Plus size={21} color={colors.background} />
                </TouchableOpacity>
            </View>

            {/* search bar */}
            <View style={styles.searchContainer}>
                <Search size={20} color={colors.textSecondary} />
                <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.searchInput}
                />
                {searchQuery.length > 0 && (

                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                        <X size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                )}
            </View>
            {/* date selector */}
            <View style={styles.dateRow}>

                <TouchableOpacity
                    style={styles.dateButton}
                    onPress={() => setCalendarVisible(true)}
                    activeOpacity={0.8}>

                    <CalendarDays size={19} color={colors.champagne} />

                    <Text style={styles.dateButtonText}>
                        {selectedDate
                            ? formatSelectedDate(selectedDate)
                            : 'Select a date'}
                    </Text>
                </TouchableOpacity>
                {selectedDate && (
                    <TouchableOpacity
                        style={styles.clearDateButton}
                        onPress={() => setSelectedDate(null)}
                    >
                        <X size={17} color={colors.textSecondary} />
                        <Text style={styles.clearDateText}>
                            Clear
                        </Text>
                    </TouchableOpacity>
                )}

            </View>
            {/* filter pills */}
            <View style={styles.filterRow}>
                {(['ALL', 'CREDIT', 'DEBIT'] as const).map(
                    (type) => {
                        const active = filter === type;
                        return (
                            <TouchableOpacity
                                key={type}
                                style={[
                                    styles.filterPill,
                                    active && {
                                        backgroundColor: colors.champagne + '20',
                                        borderWidth: 1,
                                        borderColor: colors.champagne,
                                    },
                                ]}
                                onPress={() => setFilter(type)}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.filterPillText, active && {
                                    color: colors.champagne,
                                },
                                ]}>
                                    {type === 'ALL'
                                        ? 'All'
                                        : type === 'CREDIT'
                                            ? 'Income'
                                            : 'Expenses'
                                    }
                                </Text>
                            </TouchableOpacity>
                        );
                    }
                )}
            </View>
            {/* result inforamtion  */}
            < View style={styles.resultHeader} >
                <Text style={styles.resultText}>
                    {selectedDate
                        ? `Transactions on ${formatSelectedDate(selectedDate)}`
                        : 'All transactions'}
                </Text>
                <Text style={styles.resultCount}>
                    {filteredTransactions.length}
                </Text>
            </View >
            {/* transacion list */}
            {filteredTransactions.length == 0 ? (
                <View style={styles.emptyState}>
                    <CreditCard size={52} color={colors.champagne} style={{ marginBottom: 12 }} />
                    <Text style={styles.emptyTitle}>
                        No transactions found
                    </Text>
                    <Text style={styles.emptySubtitle}>
                        Try changing your search, filter, or date.
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={filteredTransactions}
                    keyExtractor={(item) => item.id}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.listContent}
                    renderItem={({ item }) => (
                        <TransactionRow
                            transaction={item}
                            category={getCategoryById(item.categoryId)}
                            onEdit={() => setEditingTx(item)}
                            onDelete={() => handleDelete(item)}
                        />
                    )}
                />
            )}
            {/* calendar modal */}
            <Modal
                visible={calendarVisible}
                transparent
                animationType='fade'
                onRequestClose={() => setCalendarVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View>

                        <View style={styles.calendarContainer}>
                            {/* calednar header */}
                            <View style={styles.calendarHeader}>
                                <View>
                                    <Text style={styles.calendarTitle}>
                                        Select date
                                    </Text>
                                    <Text style={styles.calendarSubtitle}>Choose a specific day</Text>
                                </View>
                                <TouchableOpacity
                                    onPress={() => setCalendarVisible(false)}
                                    style={styles.closeCalendarButton}
                                >
                                    <X size={20} color={colors.textSecondary} />
                                </TouchableOpacity>
                            </View>
                            <Calendar current={
                                selectedDate ??
                                new Date().toISOString().split('T')[0]
                            }
                                markedDates={markedDates}
                                onDayPress={(day) => {
                                    setSelectedDate(day.dateString);
                                    setCalendarVisible(false);
                                }}
                                enableSwipeMonths
                                theme={{

                                    backgroundColor: colors.surface,
                                    calendarBackground: colors.surface,

                                    textSectionTitleColor: colors.textSecondary,

                                    selectedDayBackgroundColor: colors.champagne,
                                    selectedDayTextColor: colors.background,

                                    todayTextColor: colors.champagne,
                                    dayTextColor: colors.textPrimary,

                                    textDisabledColor: colors.textMuted,
                                    monthTextColor: colors.textPrimary,
                                    arrowColor: colors.champagne,

                                    textMonthFontWeight: '700',
                                    textDayFontWeight: '500',
                                    textDayHeaderFontWeight: '600',
                                }}
                            />
                            {/* All dates */}
                            <TouchableOpacity style={
                                styles.allDatesButton}
                                onPress={() => {
                                    setSelectedDate(null);
                                    setCalendarVisible(false);
                                }}>
                                <Text style={styles.allDatesText}>
                                    Show all dates
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                </View>
            </Modal>
            <AddTransactionModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                defaultType={modalType}
            />
            <EditTransactionModal
                visible={!!editingTx}
                transaction={editingTx}
                onClose={() => setEditingTx(null)}
            />

        </SafeAreaView >
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) => StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingTop: 2,
        paddingBottom: 12,
    },

    headerText: {
        flex: 1,
        paddingRight: 12,
    },

    headerTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },

    headerSubtitle: {
        fontSize: 14,
        color: colors.textSecondary,
        marginTop: 4,
    },

    addButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.champagne,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 10,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        marginHorizontal: 15,
        marginVertical: 10,
        borderRadius: 14,
        borderWidth: 0,
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        color: colors.textPrimary,
    },
    // DATE
    dateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 15,
        gap: 8,
        marginBottom: 10,
    },
    dateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 13,
        backgroundColor: colors.surface,
        borderWidth: 0,
    },
    dateButtonText: {
        color: colors.textPrimary,
        fontSize: 14,
        fontWeight: '600',
    },
    clearDateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    clearDateText: {
        color: colors.textSecondary,
        fontSize: 13,
    },
    // FILTER
    filterRow: {
        flexDirection: 'row',
        paddingHorizontal: 15,
        gap: 8,
        marginBottom: 8,
    },
    filterPill: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 15,
        backgroundColor: colors.surface,
        borderWidth: 0,
        borderColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
    },
    filterPillText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    // RESULTS
    resultHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 15,
        marginBottom: 8,
    },
    resultText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    resultCount: {
        fontSize: 13,
        fontWeight: '700',
        color: colors.champagne,
    },
    listContent: {
        paddingHorizontal: 10,
        paddingBottom: 32,
    },
    // EMPTY
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 30,
        gap: 8,
    },
    emptyTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    emptySubtitle: {
        fontSize: 14,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    // CALENDAR MODAL
    modalOverlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    calendarContainer: {
        backgroundColor: colors.surface,
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
    },
    calendarHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 8,
    },
    calendarTitle: {
        fontSize: 19,
        fontWeight: '700',
        color: colors.textPrimary,
    },
    calendarSubtitle: {
        fontSize: 13,
        color: colors.textSecondary,
        marginTop: 3,
    },
    closeCalendarButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
    },
    allDatesButton: {
        marginHorizontal: 18,
        marginBottom: 18,
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
        backgroundColor: colors.surfaceAlt,
    },
    allDatesText: {
        color: colors.champagne,
        fontSize: 14,
        fontWeight: '600',
    },

});