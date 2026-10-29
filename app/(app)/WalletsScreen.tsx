// frontend/app/(app)/WalletsScreen.tsx
// Dedicated Wallets screen for BanKoni Ethiopian personal finance.
// Supports viewing wallets, provider logos, legitimate opening balances,
// creating/editing wallets, setting default, archiving, and transaction history.

import { useState, useMemo } from 'react';
import {
    Alert,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
    Archive,
    ArchiveRestore,
    ArrowDownLeft,
    ArrowUpRight,
    ChevronRight,
    Settings2,
    Star,
    Trash2,
    WalletCards,
} from 'lucide-react-native';

import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import { Wallet } from '../../types/Wallet';
import { getWalletProvider } from '../../constants/walletProviders';
import WalletLogo from '../../components/wallets/WalletLogo';
import FloatingActionButton from '../../components/common/buttons/FloatingActionButton';
import AddWalletModal from '../../components/modals/AddWalletModal';
import EditWalletModal from '../../components/modals/EditWalletModal';

export default function WalletsScreen() {
    const colors = useTheme();
    const styles = createStyles(colors);

    const wallets = useBanKoniStore((state) => state.wallets);
    const transactions = useBanKoniStore((state) => state.transactions);
    const categories = useBanKoniStore((state) => state.categories);
    const updateWallet = useBanKoniStore((state) => state.updateWallet);
    const setDefaultWallet = useBanKoniStore((state) => state.setDefaultWallet);
    const archiveWallet = useBanKoniStore((state) => state.archiveWallet);
    const deleteWallet = useBanKoniStore((state) => state.deleteWallet);

    const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
    const [isAddModalVisible, setIsAddModalVisible] = useState(false);
    const [editingWallet, setEditingWallet] = useState<Wallet | null>(null);
    const [showArchived, setShowArchived] = useState(false);

    // Active vs archived wallets
    const activeWallets = useMemo(
        () => wallets.filter((w) => !w.isArchived),
        [wallets],
    );
    const archivedWallets = useMemo(
        () => wallets.filter((w) => w.isArchived),
        [wallets],
    );

    const totalActiveBalance = useMemo(
        () => activeWallets
            .filter((w) => w.currency === 'ETB')
            .reduce((sum, w) => sum + w.balance, 0),
        [activeWallets],
    );

    const displayedWallets = showArchived ? archivedWallets : activeWallets;

    const walletTransactions = useMemo(() => {
        if (!selectedWalletId) return [];
        return transactions.filter((t) => t.walletId === selectedWalletId);
    }, [transactions, selectedWalletId]);

    const openEditModal = (wallet: Wallet) => {
        setEditingWallet(wallet);
    };

    const handleSaveEditedWallet = async (
        id: string,
        newName: string,
        newOpening: string,
        newLast4: string,
        newIsDefault: boolean,
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
                accountNumberLast4: newLast4.trim() ? newLast4.trim().slice(-4) : undefined,
                isDefault: newIsDefault,
            });
            setEditingWallet(null);
        } catch (error) {
            Alert.alert('Update Failed', error instanceof Error ? error.message : 'Could not update wallet.');
        }
    };

    const handleToggleArchive = (wallet: Wallet) => {
        if (!wallet.isArchived && wallet.isDefault) {
            Alert.alert(
                'Cannot Archive Default Wallet',
                'Set another wallet as your default before archiving this one.',
            );
            return;
        }

        const actionText = wallet.isArchived ? 'Restore' : 'Archive';
        Alert.alert(
            `${actionText} Wallet?`,
            wallet.isArchived
                ? `Restore "${wallet.name}" to your active wallets?`
                : `Archiving "${wallet.name}" hides it from transaction pickers while preserving all its historical records.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: actionText,
                    onPress: async () => {
                        try {
                            await archiveWallet(wallet.id, !wallet.isArchived);
                        } catch (err) {
                            Alert.alert('Error', err instanceof Error ? err.message : 'Action failed.');
                        }
                    },
                },
            ],
        );
    };

    const handleDeleteWallet = (wallet: Wallet) => {
        if (wallet.isDefault) {
            Alert.alert(
                'Default Wallet Protected',
                'You cannot delete the default wallet. Set another wallet as default first.',
            );
            return;
        }

        const hasTx = transactions.some((t) => t.walletId === wallet.id);
        if (hasTx) {
            Alert.alert(
                'Wallet Has Transactions',
                `"${wallet.name}" contains recorded transactions and cannot be deleted. Archive it instead to hide it safely without erasing financial history.`,
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Archive Instead', onPress: () => void archiveWallet(wallet.id, true) },
                ],
            );
            return;
        }

        Alert.alert(
            'Delete Wallet?',
            `Are you sure you want to delete "${wallet.name}"? This cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteWallet(wallet.id);
                            if (selectedWalletId === wallet.id) setSelectedWalletId(null);
                        } catch (err) {
                            Alert.alert('Error', err instanceof Error ? err.message : 'Could not delete wallet.');
                        }
                    },
                },
            ],
        );
    };

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar style={colors.statusBar} />

            {/* Header */}
            <View style={styles.header}>
                <View style={styles.headerText}>
                    <Text style={styles.headerTitle}>Wallets</Text>
                    <Text style={styles.headerSubtitle}>
                        Your cash, Ethiopian bank accounts, and mobile wallets.
                    </Text>
                </View>
                <FloatingActionButton
                    onPress={() => setIsAddModalVisible(true)}
                />
            </View>

            {/* Total Balance Summary Card */}
            <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                    <View>
                        <Text style={styles.summaryLabel}>Total Active Balance</Text>
                        <Text style={styles.summaryAmount}>
                            ETB {totalActiveBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                            <Text style={[styles.filterChipText, !showArchived && styles.filterChipTextActive]}>
                                Active ({activeWallets.length})
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.filterChip, showArchived && styles.filterChipActive]}
                            onPress={() => setShowArchived(true)}
                        >
                            <Text style={[styles.filterChipText, showArchived && styles.filterChipTextActive]}>
                                Archived ({archivedWallets.length})
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            {/* Wallets List */}
            <FlatList
                data={displayedWallets}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <WalletCards size={48} color={colors.textSecondary} />
                        <Text style={styles.emptyTitle}>
                            {showArchived ? 'No archived wallets' : 'No wallets configured'}
                        </Text>
                        <Text style={styles.emptySubtitle}>
                            {showArchived
                                ? 'Wallets you archive will appear here.'
                                : 'Tap the button below to add your bank account or mobile wallet.'}
                        </Text>
                    </View>
                }
                renderItem={({ item }) => {
                    const provider = getWalletProvider(item.providerId);
                    const isSelected = selectedWalletId === item.id;

                    return (
                        <View style={[styles.walletCard, item.isArchived && styles.walletCardArchived]}>
                            <TouchableOpacity
                                style={styles.walletCardHeader}
                                activeOpacity={0.8}
                                onPress={() => setSelectedWalletId(isSelected ? null : item.id)}
                            >
                                <WalletLogo providerId={item.providerId} size={46} />
                                <View style={styles.walletCardInfo}>
                                    <View style={styles.walletNameRow}>
                                        <Text style={styles.walletName}>{item.name}</Text>
                                        {item.isDefault && item.providerId !== 'cash' && (
                                            <View style={styles.defaultBadge}>
                                                <Text style={styles.defaultBadgeText}>Default</Text>
                                            </View>
                                        )}
                                        {item.isArchived && (
                                            <View style={styles.archivedBadge}>
                                                <Archive size={11} color={colors.textSecondary} />
                                                <Text style={styles.archivedBadgeText}>Archived</Text>
                                            </View>
                                        )}
                                    </View>
                                    <Text style={styles.providerName}>
                                        {provider.name}
                                        {item.accountNumberLast4 ? ` •••• ${item.accountNumberLast4}` : ''}
                                    </Text>
                                    <View style={styles.balanceMetaRow}>
                                        <Text style={styles.walletBalance}>
                                            {item.currency} {item.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </Text>
                                        <Text style={styles.openingNote}>
                                            Opening: {item.currency} {item.openingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </Text>
                                    </View>
                                </View>
                                <ChevronRight
                                    size={20}
                                    color={colors.textSecondary}
                                    style={{ transform: [{ rotate: isSelected ? '90deg' : '0deg' }] }}
                                />
                            </TouchableOpacity>

                            {/* Expanded Details: Actions & Recent Transactions */}
                            {isSelected && (
                                <View style={styles.expandedSection}>
                                    {/* Action Buttons */}
                                    <View style={styles.actionButtonRow}>
                                        {!item.isDefault && !item.isArchived && (
                                            <TouchableOpacity
                                                style={styles.actionBtn}
                                                onPress={() => void setDefaultWallet(item.id)}
                                            >
                                                <Text style={styles.actionBtnText}>Set Default</Text>
                                            </TouchableOpacity>
                                        )}
                                        <TouchableOpacity
                                            style={styles.actionBtn}
                                            onPress={() => openEditModal(item)}
                                        >
                                            <Settings2 size={15} color={colors.textPrimary} />
                                            <Text style={styles.actionBtnText}>Edit</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={styles.actionBtn}
                                            onPress={() => handleToggleArchive(item)}
                                        >
                                            {item.isArchived ? (
                                                <>
                                                    <ArchiveRestore size={15} color={colors.champagne} />
                                                    <Text style={styles.actionBtnText}>Restore</Text>
                                                </>
                                            ) : (
                                                <>
                                                    <Archive size={15} color={colors.textSecondary} />
                                                    <Text style={styles.actionBtnText}>Archive</Text>
                                                </>
                                            )}
                                        </TouchableOpacity>
                                        {!item.isDefault && (
                                            <TouchableOpacity
                                                style={[styles.actionBtn, styles.deleteBtn]}
                                                onPress={() => handleDeleteWallet(item)}
                                            >
                                                <Trash2 size={15} color={colors.danger} />
                                                <Text style={[styles.actionBtnText, { color: colors.danger }]}>Delete</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>

                                    {/* Recent Transactions List */}
                                    <View style={styles.recentTxSection}>
                                        <Text style={styles.recentTxTitle}>Recent Activity</Text>
                                        {walletTransactions.length === 0 ? (
                                            <Text style={styles.noTxText}>No transactions recorded for this wallet yet.</Text>
                                        ) : (
                                            walletTransactions.slice(0, 5).map((tx) => {
                                                const cat = categories.find((c) => c.id === tx.categoryId);
                                                const isCredit = tx.type === 'CREDIT';
                                                return (
                                                    <View style={styles.txRow} key={tx.id}>
                                                        <View style={[styles.txIconContainer, { backgroundColor: isCredit ? '#10B98120' : '#EF444420' }]}>
                                                            {isCredit ? (
                                                                <ArrowDownLeft size={16} color="#10B981" />
                                                            ) : (
                                                                <ArrowUpRight size={16} color="#EF4444" />
                                                            )}
                                                        </View>
                                                        <View style={styles.txDetails}>
                                                            <Text style={styles.txCategory}>{cat?.name ?? 'General'}</Text>
                                                            <Text style={styles.txDate}>
                                                                {new Date(tx.date).toLocaleDateString()} {tx.note ? `• ${tx.note}` : ''}
                                                            </Text>
                                                        </View>
                                                        <Text style={[styles.txAmount, { color: isCredit ? '#10B981' : colors.textPrimary }]}>
                                                            {isCredit ? '+' : '-'}{item.currency} {tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
            />

            {/* Modal: Add New Wallet */}
            <AddWalletModal
                visible={isAddModalVisible}
                onClose={() => setIsAddModalVisible(false)}
            />

            {/* Modal: Edit Wallet */}
            <EditWalletModal
                visible={!!editingWallet}
                wallet={editingWallet}
                onClose={() => setEditingWallet(null)}
                onSave={handleSaveEditedWallet}
            />
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
        summaryCard: {
            marginHorizontal: 16,
            marginBottom: 12,
            padding: 18,
            borderRadius: 16,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.cardBorder,
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
        },
        summaryAmount: {
            fontSize: 24,
            fontWeight: '700',
            color: colors.champagne,
            marginTop: 4,
        },
        walletCountBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: colors.surfaceAlt,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: colors.border,
        },
        walletCountText: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.textPrimary,
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
            borderRadius: 14,
            backgroundColor: colors.surfaceAlt,
        },
        filterChipActive: {
            backgroundColor: colors.champagne,
        },
        filterChipText: {
            fontSize: 12,
            color: colors.textSecondary,
            fontWeight: '500',
        },
        filterChipTextActive: {
            color: '#000000',
            fontWeight: '700',
        },
        listContent: {
            paddingHorizontal: 16,
            paddingBottom: 90,
            gap: 12,
        },
        walletCard: {
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            overflow: 'hidden',
        },
        walletCardArchived: {
            opacity: 0.75,
            borderColor: colors.border,
        },
        walletCardHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            padding: 16,
            gap: 14,
        },
        walletCardInfo: {
            flex: 1,
            gap: 3,
        },
        walletNameRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
        },
        walletName: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        defaultBadge: {
            marginLeft: 4,
        },
        defaultBadgeText: {
            fontSize: 11,
            fontWeight: '600',
            color: colors.champagne,
        },
        archivedBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
            backgroundColor: colors.surfaceAlt,
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 6,
        },
        archivedBadgeText: {
            fontSize: 10,
            color: colors.textSecondary,
        },
        providerName: {
            fontSize: 12,
            color: colors.textSecondary,
        },
        balanceMetaRow: {
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: 10,
            marginTop: 4,
        },
        walletBalance: {
            fontSize: 16,
            fontWeight: '700',
            color: colors.textPrimary,
        },
        openingNote: {
            fontSize: 11,
            color: colors.textMuted,
        },
        expandedSection: {
            borderTopWidth: 1,
            borderTopColor: colors.border,
            padding: 16,
            backgroundColor: colors.surfaceAlt,
        },
        actionButtonRow: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 16,
        },
        actionBtn: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 8,
        },
        deleteBtn: {
            borderColor: `${colors.danger}40`,
        },
        actionBtnText: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        recentTxSection: {
            gap: 8,
        },
        recentTxTitle: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
        },
        noTxText: {
            fontSize: 12,
            color: colors.textMuted,
            fontStyle: 'italic',
            marginTop: 4,
        },
        txRow: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 6,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
            gap: 10,
        },
        txIconContainer: {
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
        },
        txDetails: {
            flex: 1,
        },
        txCategory: {
            fontSize: 13,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        txDate: {
            fontSize: 11,
            color: colors.textSecondary,
        },
        txAmount: {
            fontSize: 13,
            fontWeight: '700',
        },
        emptyContainer: {
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 48,
            paddingHorizontal: 24,
            gap: 10,
        },
        emptyTitle: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        emptySubtitle: {
            fontSize: 13,
            color: colors.textSecondary,
            textAlign: 'center',
            lineHeight: 18,
        },
    });
