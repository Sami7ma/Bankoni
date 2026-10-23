// app/(app)/LedgerScreen.tsx
//
// Unified Ledger Screen for BanKoni.
// Combines Wallets (Accounts) and Transaction History into a single screen
// with a sleek top segmented tab switch.

import { useState, useMemo, useEffect } from 'react';
import {
    Alert,
    FlatList,
    Modal,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
    Archive,
    ArchiveRestore,
    ArrowDownLeft,
    ArrowLeftRight,
    ArrowUpRight,
    CalendarDays,
    ChevronRight,
    CreditCard,
    MessageSquareText,
    Plus,
    Search,
    Settings2,
    Star,
    Trash2,
    WalletCards,
    X,
} from 'lucide-react-native';
import { Calendar } from 'react-native-calendars';

import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import { Wallet } from '../../types/Wallet';
import { Transaction } from '../../types/Transaction';
import { getWalletProvider } from '../../constants/walletProviders';
import WalletLogo from '../../components/wallets/WalletLogo';
import TransactionRow from '../../components/home/TransactionRow';

import AddWalletModal from '../../components/modals/AddWalletModal';
import EditWalletModal from '../../components/modals/EditWalletModal';
import AddTransactionModal from '../../components/modals/AddTransactionModal';
import EditTransactionModal from '../../components/modals/EditTransactionModal';
import SmsImportModal from '../../components/modals/SmsImportModal';

interface LedgerScreenProps {
    route?: {
        params?: {
            initialTab?: 'wallets' | 'transactions';
        };
    };
}

export default function LedgerScreen({ route }: LedgerScreenProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    // Navigation param synchronization
    const [activeTab, setActiveTab] = useState<'wallets' | 'transactions'>(
        route?.params?.initialTab || 'wallets'
    );

    useEffect(() => {
        if (route?.params?.initialTab) {
            setActiveTab(route?.params?.initialTab);
        }
    }, [route?.params?.initialTab]);

    // Zustand Store
    const wallets = useBanKoniStore((state) => state.wallets);
    const transactions = useBanKoniStore((state) => state.transactions);
    const categories = useBanKoniStore((state) => state.categories);
    const updateWallet = useBanKoniStore((state) => state.updateWallet);
    const setDefaultWallet = useBanKoniStore((state) => state.setDefaultWallet);
    const archiveWallet = useBanKoniStore((state) => state.archiveWallet);
    const deleteWallet = useBanKoniStore((state) => state.deleteWallet);
    const deleteTransaction = useBanKoniStore((state) => state.deleteTransaction);

    // ==========================================
    // WALLETS TAB STATE
    // ==========================================
    const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
    const [isAddWalletModalVisible, setIsAddWalletModalVisible] = useState(false);
    const [editingWallet, setEditingWallet] = useState<Wallet | null>(null);
    const [showArchived, setShowArchived] = useState(false);

    const activeWallets = useMemo(() => wallets.filter((w) => !w.isArchived), [wallets]);
    const archivedWallets = useMemo(() => wallets.filter((w) => w.isArchived), [wallets]);

    const totalActiveBalance = useMemo(
        () =>
            activeWallets
                .filter((w) => w.currency === 'ETB')
                .reduce((sum, w) => sum + w.balance, 0),
        [activeWallets]
    );

    const displayedWallets = showArchived ? archivedWallets : activeWallets;

    const walletTransactions = useMemo(() => {
        if (!selectedWalletId) return [];
        return transactions.filter((t) => t.walletId === selectedWalletId);
    }, [transactions, selectedWalletId]);

    const handleSaveEditedWallet = async (
        id: string,
        newName: string,
        newOpening: string,
        newLast4: string,
        newIsDefault: boolean
    ) => {
        const cleanName = newName.trim();
        if (!cleanName) {
            Alert.alert('Name Required', 'Wallet name cannot be empty.');
            return;
        }

        const parsedOpening = parseFloat(newOpening.trim() || '0');
        if (isNaN(parsedOpening)) {
            Alert.alert('Invalid Balance', 'Please enter a valid numeric opening balance.');
            return;
        }

        try {
            await updateWallet(id, {
                name: cleanName,
                openingBalance: parsedOpening,
                accountNumberLast4: newLast4.trim() || undefined,
            });

            if (newIsDefault) {
                await setDefaultWallet(id);
            }

            setEditingWallet(null);
        } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Could not update wallet.');
        }
    };

    const handleToggleArchive = async (wallet: Wallet) => {
        try {
            const newArchived = !wallet.isArchived;
            await archiveWallet(wallet.id, newArchived);
            if (newArchived && selectedWalletId === wallet.id) {
                setSelectedWalletId(null);
            }
        } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Could not archive wallet.');
        }
    };

    const handleDeleteWallet = (wallet: Wallet) => {
        const hasTransactions = transactions.some((t) => t.walletId === wallet.id);
        if (hasTransactions) {
            Alert.alert(
                'Wallet Has Transactions',
                'This wallet has transactions recorded. Archiving it preserves your financial history while hiding it from active lists. Do you want to archive it instead?',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Archive Wallet', onPress: () => handleToggleArchive(wallet) },
                ]
            );
            return;
        }

        Alert.alert(
            'Delete Wallet',
            `Are you sure you want to delete "${wallet.name}"? This action cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteWallet(wallet.id);
                            if (selectedWalletId === wallet.id) {
                                setSelectedWalletId(null);
                            }
                        } catch (err) {
                            Alert.alert('Error', err instanceof Error ? err.message : 'Could not delete wallet.');
                        }
                    },
                },
            ]
        );
    };

    // ==========================================
    // TRANSACTIONS TAB STATE
    // ==========================================
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'ALL' | 'CREDIT' | 'DEBIT'>('ALL');
    const [isAddTxModalVisible, setIsAddTxModalVisible] = useState(false);
    const [editingTx, setEditingTx] = useState<Transaction | null>(null);
    const [smsModalVisible, setSmsModalVisible] = useState(false);
    const [calendarVisible, setCalendarVisible] = useState(false);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);

    const getCategoryById = (id: string) => categories.find((cat) => cat.id === id);

    const formatSelectedDate = (date: string) => {
        const parsedDate = new Date(`${date}T00:00:00`);
        return parsedDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    const filteredTransactions = useMemo(() => {
        let filtered = transactions;
        if (filter !== 'ALL') {
            filtered = filtered.filter((tx) => tx.type === filter);
        }
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter((tx) => {
                const category = getCategoryById(tx.categoryId);
                const categoryMatch = category?.name.toLowerCase().includes(query);
                const noteMatch = tx.note?.toLowerCase().includes(query);
                return categoryMatch || noteMatch;
            });
        }
        if (selectedDate) {
            filtered = filtered.filter((tx) => {
                const txDate = new Date(tx.date);
                const txDateKey = txDate.toISOString().split('T')[0];
                return txDateKey === selectedDate;
            });
        }

        filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return filtered;
    }, [transactions, categories, searchQuery, filter, selectedDate]);

    const handleDeleteTransaction = (tx: Transaction) => {
        const catName = getCategoryById(tx.categoryId)?.name ?? 'Transaction';
        Alert.alert('Delete Transaction', `Remove this ${catName} transaction?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: () => deleteTransaction(tx.id),
            },
        ]);
    };

    const markedDates = selectedDate
        ? {
              [selectedDate]: {
                  selected: true,
                  selectedColor: colors.champagne,
                  selectedTextColor: colors.background,
              },
          }
        : {};

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar style={colors.statusBar} />

            {/* HEADER */}
            <View style={styles.header}>
                <View style={styles.headerText}>
                    <Text style={styles.headerTitle}>Ledger</Text>
                    <Text style={styles.headerSubtitle}>
                        {activeTab === 'wallets'
                            ? 'Accounts, cash & mobile money balances'
                            : 'Search and explore your transaction history'}
                    </Text>
                </View>

                <View style={styles.headerActions}>
                    {activeTab === 'transactions' && (
                        <TouchableOpacity
                            style={styles.smsButton}
                            onPress={() => setSmsModalVisible(true)}
                            activeOpacity={0.8}
                            accessibilityLabel="Import from SMS"
                        >
                            <MessageSquareText size={19} color={colors.champagne} />
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        style={styles.addButton}
                        onPress={() => {
                            if (activeTab === 'wallets') {
                                setIsAddWalletModalVisible(true);
                            } else {
                                setIsAddTxModalVisible(true);
                            }
                        }}
                        activeOpacity={0.8}
                        accessibilityLabel={activeTab === 'wallets' ? 'Add Wallet' : 'Add Transaction'}
                    >
                        <Plus size={20} color={colors.background} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* SEGMENTED SWITCH */}
            <View style={styles.segmentWrapper}>
                <View style={styles.segmentContainer}>
                    <TouchableOpacity
                        style={[styles.segmentBtn, activeTab === 'wallets' && styles.segmentBtnActive]}
                        onPress={() => setActiveTab('wallets')}
                        activeOpacity={0.85}
                    >
                        <WalletCards
                            size={16}
                            color={activeTab === 'wallets' ? colors.champagne : colors.textSecondary}
                        />
                        <Text
                            style={[
                                styles.segmentBtnText,
                                activeTab === 'wallets' && styles.segmentBtnTextActive,
                            ]}
                        >
                            Wallets ({activeWallets.length})
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.segmentBtn, activeTab === 'transactions' && styles.segmentBtnActive]}
                        onPress={() => setActiveTab('transactions')}
                        activeOpacity={0.85}
                    >
                        <ArrowLeftRight
                            size={16}
                            color={activeTab === 'transactions' ? colors.champagne : colors.textSecondary}
                        />
                        <Text
                            style={[
                                styles.segmentBtnText,
                                activeTab === 'transactions' && styles.segmentBtnTextActive,
                            ]}
                        >
                            Transactions ({transactions.length})
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* ============================================================== */}
            {/* VIEW 1: WALLETS TAB                                           */}
            {/* ============================================================== */}
            {activeTab === 'wallets' ? (
                <FlatList
                    data={displayedWallets}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.walletsListContent}
                    ListHeaderComponent={
                        <View style={styles.walletsHeaderComponent}>
                            {/* Total Balance Card */}
                            <View style={styles.summaryCard}>
                                <View style={styles.summaryRow}>
                                    <View>
                                        <Text style={styles.summaryLabel}>Total Active Balance</Text>
                                        <Text style={styles.summaryAmount}>
                                            ETB{' '}
                                            {totalActiveBalance.toLocaleString('en-US', {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                            })}
                                        </Text>
                                    </View>
                                    <View style={styles.walletCountBadge}>
                                        <WalletCards size={18} color={colors.champagne} />
                                        <Text style={styles.walletCountText}>
                                            {activeWallets.length} {activeWallets.length === 1 ? 'Wallet' : 'Wallets'}
                                        </Text>
                                    </View>
                                </View>

                                {/* Filter toggle if archived wallets exist */}
                                {archivedWallets.length > 0 && (
                                    <View style={styles.toggleRow}>
                                        <TouchableOpacity
                                            style={[styles.filterChip, !showArchived && styles.filterChipActive]}
                                            onPress={() => setShowArchived(false)}
                                        >
                                            <Text
                                                style={[
                                                    styles.filterChipText,
                                                    !showArchived && styles.filterChipTextActive,
                                                ]}
                                            >
                                                Active ({activeWallets.length})
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.filterChip, showArchived && styles.filterChipActive]}
                                            onPress={() => setShowArchived(true)}
                                        >
                                            <Text
                                                style={[
                                                    styles.filterChipText,
                                                    showArchived && styles.filterChipTextActive,
                                                ]}
                                            >
                                                Archived ({archivedWallets.length})
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>
                        </View>
                    }
                    renderItem={({ item }) => {
                        const provider = getWalletProvider(item.providerId);
                        const isExpanded = selectedWalletId === item.id;

                        return (
                            <View style={[styles.walletCard, item.isDefault && styles.defaultWalletCard]}>
                                <TouchableOpacity
                                    activeOpacity={0.8}
                                    onPress={() => setSelectedWalletId(isExpanded ? null : item.id)}
                                    style={styles.walletCardHeader}
                                >
                                    <WalletLogo providerId={item.providerId} size={42} />

                                    <View style={styles.walletMainInfo}>
                                        <View style={styles.walletNameRow}>
                                            <Text style={styles.walletName}>{item.name}</Text>
                                            {item.isDefault && (
                                                <View style={styles.defaultBadge}>
                                                    <Star size={10} color={colors.champagne} fill={colors.champagne} />
                                                    <Text style={styles.defaultBadgeText}>Default</Text>
                                                </View>
                                            )}
                                        </View>

                                        <Text style={styles.walletProviderName}>
                                            {provider.name}
                                            {item.accountNumberLast4 ? ` •••• ${item.accountNumberLast4}` : ''}
                                        </Text>
                                    </View>

                                    <View style={styles.walletBalanceContainer}>
                                        <Text style={styles.walletBalance}>
                                            ETB{' '}
                                            {item.balance.toLocaleString('en-US', {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                            })}
                                        </Text>
                                        <ChevronRight
                                            size={16}
                                            color={colors.textSecondary}
                                            style={{
                                                transform: [{ rotate: isExpanded ? '90deg' : '0deg' }],
                                            }}
                                        />
                                    </View>
                                </TouchableOpacity>

                                {/* Expanded Details: Actions & Recent Transactions */}
                                {isExpanded && (
                                    <View style={styles.walletExpandedArea}>
                                        <View style={styles.divider} />

                                        {/* Actions Bar */}
                                        <View style={styles.actionsBar}>
                                            {!item.isDefault && !item.isArchived && (
                                                <TouchableOpacity
                                                    style={styles.actionBtn}
                                                    onPress={() => setDefaultWallet(item.id)}
                                                >
                                                    <Star size={14} color={colors.champagne} />
                                                    <Text style={styles.actionBtnText}>Set Default</Text>
                                                </TouchableOpacity>
                                            )}

                                            <TouchableOpacity
                                                style={styles.actionBtn}
                                                onPress={() => setEditingWallet(item)}
                                            >
                                                <Settings2 size={14} color={colors.textSecondary} />
                                                <Text style={styles.actionBtnText}>Edit</Text>
                                            </TouchableOpacity>

                                            <TouchableOpacity
                                                style={styles.actionBtn}
                                                onPress={() => handleToggleArchive(item)}
                                            >
                                                {item.isArchived ? (
                                                    <ArchiveRestore size={14} color={colors.champagne} />
                                                ) : (
                                                    <Archive size={14} color={colors.textSecondary} />
                                                )}
                                                <Text style={styles.actionBtnText}>
                                                    {item.isArchived ? 'Restore' : 'Archive'}
                                                </Text>
                                            </TouchableOpacity>

                                            <TouchableOpacity
                                                style={[styles.actionBtn, styles.deleteActionBtn]}
                                                onPress={() => handleDeleteWallet(item)}
                                            >
                                                <Trash2 size={14} color={colors.danger} />
                                                <Text style={[styles.actionBtnText, { color: colors.danger }]}>
                                                    Delete
                                                </Text>
                                            </TouchableOpacity>
                                        </View>

                                        {/* Recent Transactions List */}
                                        <View style={styles.recentTxSection}>
                                            <Text style={styles.recentTxTitle}>Recent Activity</Text>
                                            {walletTransactions.length === 0 ? (
                                                <Text style={styles.noTxText}>No transactions recorded yet.</Text>
                                            ) : (
                                                walletTransactions.slice(0, 5).map((tx) => {
                                                    const cat = getCategoryById(tx.categoryId);
                                                    const isCredit = tx.type === 'CREDIT';

                                                    return (
                                                        <View key={tx.id} style={styles.miniTxRow}>
                                                            <View style={styles.miniTxLeft}>
                                                                {isCredit ? (
                                                                    <ArrowUpRight size={14} color={colors.success} />
                                                                ) : (
                                                                    <ArrowDownLeft size={14} color={colors.danger} />
                                                                )}
                                                                <Text style={styles.miniTxCategory}>
                                                                    {cat?.name ?? 'General'}
                                                                </Text>
                                                            </View>
                                                            <Text
                                                                style={[
                                                                    styles.miniTxAmount,
                                                                    { color: isCredit ? colors.success : colors.danger },
                                                                ]}
                                                            >
                                                                {isCredit ? '+' : '-'}ETB{' '}
                                                                {tx.amount.toLocaleString('en-US', {
                                                                    minimumFractionDigits: 2,
                                                                    maximumFractionDigits: 2,
                                                                })}
                                                            </Text>
                                                        </View>
                                                    );
                                                })
                                            )}
                                        </View>
                                    </View>
                                )}
                            </View>
                        );
                    }}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <WalletCards size={48} color={colors.textSecondary} />
                            <Text style={styles.emptyTitle}>
                                {showArchived ? 'No Archived Wallets' : 'No Wallets Found'}
                            </Text>
                            <Text style={styles.emptySubtitle}>
                                {showArchived
                                    ? 'Wallets you archive will appear here.'
                                    : 'Add your cash, Ethiopian banks, or mobile money accounts.'}
                            </Text>
                        </View>
                    }
                />
            ) : (
                /* ============================================================== */
                /* VIEW 2: TRANSACTIONS TAB                                       */
                /* ============================================================== */
                <View style={styles.transactionsContainer}>
                    {/* Search Bar */}
                    <View style={styles.searchContainer}>
                        <Search size={18} color={colors.textSecondary} />
                        <TextInput
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder="Search by note or category..."
                            placeholderTextColor={colors.textSecondary}
                            style={styles.searchInput}
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchQuery('')}>
                                <X size={18} color={colors.textSecondary} />
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Date Selector */}
                    <View style={styles.dateRow}>
                        <TouchableOpacity
                            style={styles.dateButton}
                            onPress={() => setCalendarVisible(true)}
                            activeOpacity={0.8}
                        >
                            <CalendarDays size={18} color={colors.champagne} />
                            <Text style={styles.dateButtonText}>
                                {selectedDate ? formatSelectedDate(selectedDate) : 'Select a date'}
                            </Text>
                        </TouchableOpacity>

                        {selectedDate && (
                            <TouchableOpacity
                                style={styles.clearDateButton}
                                onPress={() => setSelectedDate(null)}
                            >
                                <X size={16} color={colors.textSecondary} />
                                <Text style={styles.clearDateText}>Clear</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Filter Pills */}
                    <View style={styles.filterRow}>
                        {(['ALL', 'CREDIT', 'DEBIT'] as const).map((type) => {
                            const active = filter === type;
                            const label = type === 'ALL' ? 'All' : type === 'CREDIT' ? 'Income' : 'Expenses';

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
                                    <Text
                                        style={[
                                            styles.filterPillText,
                                            active && { color: colors.champagne, fontWeight: '700' },
                                        ]}
                                    >
                                        {label}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    {/* Transaction List */}
                    <FlatList
                        data={filteredTransactions}
                        keyExtractor={(item) => item.id}
                        contentContainerStyle={styles.transactionsListContent}
                        renderItem={({ item }) => (
                            <TransactionRow
                                transaction={item}
                                category={getCategoryById(item.categoryId)}
                                onEdit={() => setEditingTx(item)}
                                onDelete={() => handleDeleteTransaction(item)}
                                onPress={() => setEditingTx(item)}
                            />
                        )}
                        ListEmptyComponent={
                            <View style={styles.emptyContainer}>
                                <CreditCard size={44} color={colors.textSecondary} />
                                <Text style={styles.emptyTitle}>No Transactions Found</Text>
                                <Text style={styles.emptySubtitle}>
                                    {searchQuery || selectedDate || filter !== 'ALL'
                                        ? 'No records match your active filters.'
                                        : 'Tap "+" or "Import from SMS" to record your first transaction.'}
                                </Text>
                            </View>
                        }
                    />
                </View>
            )}

            {/* ============================================================== */}
            {/* SHARED MODALS                                                  */}
            {/* ============================================================== */}
            <AddWalletModal
                visible={isAddWalletModalVisible}
                onClose={() => setIsAddWalletModalVisible(false)}
            />

            <EditWalletModal
                visible={!!editingWallet}
                wallet={editingWallet}
                onClose={() => setEditingWallet(null)}
                onSave={handleSaveEditedWallet}
            />

            <AddTransactionModal
                visible={isAddTxModalVisible}
                defaultType="DEBIT"
                onClose={() => setIsAddTxModalVisible(false)}
                onOpenSmsImport={() => setSmsModalVisible(true)}
            />

            <EditTransactionModal
                visible={!!editingTx}
                transaction={editingTx}
                onClose={() => setEditingTx(null)}
            />

            <SmsImportModal
                visible={smsModalVisible}
                onClose={() => setSmsModalVisible(false)}
            />

            {/* Calendar Modal */}
            <Modal
                visible={calendarVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setCalendarVisible(false)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={() => setCalendarVisible(false)}
                >
                    <View style={styles.calendarContainer}>
                        <Calendar
                            onDayPress={(day: { dateString: string }) => {
                                setSelectedDate(day.dateString);
                                setCalendarVisible(false);
                            }}
                            markedDates={markedDates}
                            theme={{
                                backgroundColor: colors.surface,
                                calendarBackground: colors.surface,
                                textSectionTitleColor: colors.textSecondary,
                                selectedDayBackgroundColor: colors.champagne,
                                selectedDayTextColor: colors.background,
                                todayTextColor: colors.champagne,
                                dayTextColor: colors.textPrimary,
                                textDisabledColor: colors.textSecondary + '40',
                                monthTextColor: colors.textPrimary,
                                arrowColor: colors.champagne,
                            }}
                        />
                    </View>
                </TouchableOpacity>
            </Modal>
        </SafeAreaView>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        safeArea: {
            flex: 1,
            backgroundColor: colors.background,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 8,
        },
        headerText: {
            flex: 1,
        },
        headerTitle: {
            fontSize: 26,
            fontWeight: '700',
            color: colors.textPrimary,
            letterSpacing: 0.3,
        },
        headerSubtitle: {
            fontSize: 12,
            color: colors.textSecondary,
            marginTop: 2,
        },
        headerActions: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
        },
        addButton: {
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.champagne,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: colors.champagne,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.25,
            shadowRadius: 6,
            elevation: 4,
        },
        smsButton: {
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: colors.border,
        },
        segmentWrapper: {
            paddingHorizontal: 20,
            marginTop: 8,
            marginBottom: 12,
        },
        segmentContainer: {
            flexDirection: 'row',
            backgroundColor: colors.surfaceAlt,
            borderRadius: 14,
            padding: 4,
            borderWidth: 1,
            borderColor: colors.border,
        },
        segmentBtn: {
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            paddingVertical: 9,
            borderRadius: 10,
        },
        segmentBtnActive: {
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: `${colors.champagne}40`,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 3,
            elevation: 2,
        },
        segmentBtnText: {
            fontSize: 13,
            fontWeight: '600',
            color: colors.textSecondary,
        },
        segmentBtnTextActive: {
            color: colors.champagne,
            fontWeight: '700',
        },

        // Wallets View Styles
        walletsListContent: {
            paddingHorizontal: 20,
            paddingBottom: 40,
        },
        walletsHeaderComponent: {
            marginBottom: 14,
        },
        summaryCard: {
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: colors.border,
        },
        summaryRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        summaryLabel: {
            fontSize: 12,
            color: colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontWeight: '600',
        },
        summaryAmount: {
            fontSize: 22,
            fontWeight: '700',
            color: colors.champagne,
            marginTop: 4,
        },
        walletCountBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: `${colors.champagne}15`,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: `${colors.champagne}30`,
        },
        walletCountText: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.champagne,
        },
        toggleRow: {
            flexDirection: 'row',
            gap: 8,
            marginTop: 14,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
        },
        filterChip: {
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 12,
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
        },
        filterChipActive: {
            backgroundColor: `${colors.champagne}20`,
            borderColor: colors.champagne,
        },
        filterChipText: {
            fontSize: 12,
            color: colors.textSecondary,
            fontWeight: '500',
        },
        filterChipTextActive: {
            color: colors.champagne,
            fontWeight: '600',
        },
        walletCard: {
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            marginBottom: 12,
            overflow: 'hidden',
        },
        defaultWalletCard: {
            borderColor: `${colors.champagne}60`,
        },
        walletCardHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            padding: 14,
            gap: 12,
        },
        walletMainInfo: {
            flex: 1,
        },
        walletNameRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        walletName: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        defaultBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
            backgroundColor: `${colors.champagne}20`,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 6,
        },
        defaultBadgeText: {
            fontSize: 9,
            fontWeight: '700',
            color: colors.champagne,
            textTransform: 'uppercase',
        },
        walletProviderName: {
            fontSize: 12,
            color: colors.textSecondary,
            marginTop: 2,
        },
        walletBalanceContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        walletBalance: {
            fontSize: 14,
            fontWeight: '700',
            color: colors.textPrimary,
        },
        walletExpandedArea: {
            paddingHorizontal: 14,
            paddingBottom: 14,
        },
        divider: {
            height: 1,
            backgroundColor: colors.border,
            marginBottom: 12,
        },
        actionsBar: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 14,
        },
        actionBtn: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            backgroundColor: colors.surfaceAlt,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
        },
        deleteActionBtn: {
            borderColor: `${colors.danger}40`,
            backgroundColor: `${colors.danger}10`,
        },
        actionBtnText: {
            fontSize: 11,
            fontWeight: '600',
            color: colors.textSecondary,
        },
        recentTxSection: {
            backgroundColor: colors.surfaceAlt,
            borderRadius: 10,
            padding: 10,
        },
        recentTxTitle: {
            fontSize: 11,
            fontWeight: '700',
            color: colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 8,
        },
        noTxText: {
            fontSize: 12,
            color: colors.textSecondary,
            fontStyle: 'italic',
        },
        miniTxRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 4,
        },
        miniTxLeft: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        miniTxCategory: {
            fontSize: 12,
            color: colors.textPrimary,
        },
        miniTxAmount: {
            fontSize: 12,
            fontWeight: '600',
        },

        // Transactions View Styles
        transactionsContainer: {
            flex: 1,
        },
        searchContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surface,
            marginHorizontal: 20,
            marginBottom: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 8,
        },
        searchInput: {
            flex: 1,
            fontSize: 14,
            color: colors.textPrimary,
        },
        dateRow: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 20,
            marginBottom: 10,
            gap: 8,
        },
        dateButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 7,
            backgroundColor: colors.surface,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
        },
        dateButtonText: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        clearDateButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 8,
            paddingVertical: 6,
        },
        clearDateText: {
            fontSize: 12,
            color: colors.textSecondary,
        },
        filterRow: {
            flexDirection: 'row',
            paddingHorizontal: 20,
            marginBottom: 12,
            gap: 8,
        },
        filterPill: {
            paddingHorizontal: 14,
            paddingVertical: 6,
            borderRadius: 20,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
        },
        filterPillText: {
            fontSize: 12,
            color: colors.textSecondary,
            fontWeight: '600',
        },
        transactionsListContent: {
            paddingHorizontal: 20,
            paddingBottom: 40,
        },

        // Empty States
        emptyContainer: {
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 48,
            gap: 8,
        },
        emptyTitle: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.textPrimary,
            marginTop: 8,
        },
        emptySubtitle: {
            fontSize: 13,
            color: colors.textSecondary,
            textAlign: 'center',
            paddingHorizontal: 32,
        },
        modalOverlay: {
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 20,
        },
        calendarContainer: {
            backgroundColor: colors.surface,
            borderRadius: 16,
            overflow: 'hidden',
            width: '100%',
            maxWidth: 360,
            borderWidth: 1,
            borderColor: colors.border,
        },
    });
