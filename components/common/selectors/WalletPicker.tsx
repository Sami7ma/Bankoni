// components/common/selectors/WalletPicker.tsx
//
// A reusable dropdown wallet/account selector.
// Used in:
// - AddTransactionModal & EditTransactionModal (select source/destination wallet)
// - AddBudgetModal & EditBudgetModal (scope budget to specific wallet or all wallets)

import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { ChevronDown, Check, WalletCards } from 'lucide-react-native';
import useTheme from '../../../hooks/useTheme';
import type { Wallet } from '../../../types/Wallet';
import WalletLogo from '../../wallets/WalletLogo';

interface WalletPickerProps {
    wallets: Wallet[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    label?: string;
    allowAll?: boolean;
    allLabel?: string;
    disabled?: boolean;
}

export default function WalletPicker({
    wallets,
    selectedId,
    onSelect,
    label = 'Wallet / Account',
    allowAll = false,
    allLabel = 'All Wallets',
    disabled = false,
}: WalletPickerProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    const [isOpen, setIsOpen] = useState(false);

    // Active (non-archived) wallets first
    const activeWallets = wallets.filter((w) => !w.isArchived);
    const selectedWallet = activeWallets.find((w) => w.id === selectedId);

    const isAllSelected = selectedId === null || selectedId === 'all';

    return (
        <View style={styles.container}>
            {label ? <Text style={styles.label}>{label}</Text> : null}

            <TouchableOpacity
                activeOpacity={0.8}
                disabled={disabled}
                style={[styles.selectorButton, disabled && styles.disabled]}
                onPress={() => setIsOpen(!isOpen)}
            >
                <View style={styles.selectedContent}>
                    {isAllSelected && allowAll ? (
                        <View style={styles.allIconContainer}>
                            <WalletCards size={20} color={colors.champagne} />
                        </View>
                    ) : selectedWallet ? (
                        <WalletLogo providerId={selectedWallet.providerId} size={26} />
                    ) : (
                        <View style={styles.allIconContainer}>
                            <WalletCards size={20} color={colors.textSecondary} />
                        </View>
                    )}

                    <View style={styles.textContainer}>
                        <Text style={styles.walletName} numberOfLines={1}>
                            {isAllSelected && allowAll
                                ? allLabel
                                : selectedWallet?.name ?? 'Select Wallet'}
                        </Text>
                        {!isAllSelected && selectedWallet && (
                            <Text style={styles.walletBalance} numberOfLines={1}>
                                Balance: ETB {selectedWallet.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Text>
                        )}
                        {isAllSelected && allowAll && (
                            <Text style={styles.walletBalance} numberOfLines={1}>
                                Across all active wallets
                            </Text>
                        )}
                    </View>
                </View>

                <ChevronDown size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            {isOpen && (
                <View style={styles.list}>
                    <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                        {allowAll && (
                            <TouchableOpacity
                                activeOpacity={0.7}
                                style={[styles.item, isAllSelected && styles.selectedItem]}
                                onPress={() => {
                                    onSelect(null);
                                    setIsOpen(false);
                                }}
                            >
                                <View style={styles.itemLeft}>
                                    <View style={styles.allIconContainerSmall}>
                                        <WalletCards size={18} color={colors.champagne} />
                                    </View>
                                    <View style={styles.itemTextCol}>
                                        <Text style={[styles.itemName, isAllSelected && styles.selectedText]}>
                                            {allLabel}
                                        </Text>
                                        <Text style={styles.itemSubtext}>No specific wallet filter</Text>
                                    </View>
                                </View>
                                {isAllSelected && <Check size={17} color={colors.champagne} />}
                            </TouchableOpacity>
                        )}

                        {activeWallets.length === 0 ? (
                            <Text style={styles.emptyText}>No wallets available</Text>
                        ) : (
                            activeWallets.map((wallet) => {
                                const isSelected = wallet.id === selectedId;
                                return (
                                    <TouchableOpacity
                                        key={wallet.id}
                                        activeOpacity={0.7}
                                        style={[styles.item, isSelected && styles.selectedItem]}
                                        onPress={() => {
                                            onSelect(wallet.id);
                                            setIsOpen(false);
                                        }}
                                    >
                                        <View style={styles.itemLeft}>
                                            <WalletLogo providerId={wallet.providerId} size={28} />
                                            <View style={styles.itemTextCol}>
                                                <View style={styles.nameRow}>
                                                    <Text
                                                        style={[styles.itemName, isSelected && styles.selectedText]}
                                                        numberOfLines={1}
                                                    >
                                                        {wallet.name}
                                                    </Text>
                                                    {wallet.isDefault && (
                                                        <View style={styles.defaultBadge}>
                                                            <Text style={styles.defaultBadgeText}>Default</Text>
                                                        </View>
                                                    )}
                                                </View>
                                                <Text style={styles.itemSubtext}>
                                                    ETB {wallet.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </Text>
                                            </View>
                                        </View>
                                        {isSelected && <Check size={17} color={colors.champagne} />}
                                    </TouchableOpacity>
                                );
                            })
                        )}
                    </ScrollView>
                </View>
            )}
        </View>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        container: {
            gap: 8,
        },
        label: {
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 1,
            color: colors.textSecondary,
            textTransform: 'uppercase',
        },
        selectorButton: {
            minHeight: 56,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 14,
            borderWidth: 1,
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
        },
        disabled: {
            opacity: 0.6,
        },
        selectedContent: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            flex: 1,
        },
        allIconContainer: {
            width: 32,
            height: 32,
            borderRadius: 10,
            backgroundColor: `${colors.champagne}15`,
            alignItems: 'center',
            justifyContent: 'center',
        },
        allIconContainerSmall: {
            width: 28,
            height: 28,
            borderRadius: 8,
            backgroundColor: `${colors.champagne}15`,
            alignItems: 'center',
            justifyContent: 'center',
        },
        textContainer: {
            flex: 1,
            gap: 2,
        },
        walletName: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        walletBalance: {
            fontSize: 12,
            color: colors.textSecondary,
        },
        list: {
            maxHeight: 200,
            marginTop: 4,
            borderRadius: 14,
            borderWidth: 1,
            overflow: 'hidden',
            backgroundColor: colors.surface,
            borderColor: colors.border,
        },
        item: {
            minHeight: 52,
            paddingHorizontal: 14,
            paddingVertical: 8,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        selectedItem: {
            backgroundColor: `${colors.champagne}12`,
        },
        itemLeft: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            flex: 1,
        },
        itemTextCol: {
            flex: 1,
            gap: 2,
        },
        nameRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        itemName: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        selectedText: {
            color: colors.champagne,
            fontWeight: '700',
        },
        itemSubtext: {
            fontSize: 12,
            color: colors.textSecondary,
        },
        defaultBadge: {
            marginLeft: 4,
        },
        defaultBadgeText: {
            fontSize: 11,
            fontWeight: '600',
            color: colors.champagne,
        },
        emptyText: {
            padding: 16,
            fontSize: 14,
            color: colors.textSecondary,
            textAlign: 'center',
        },
    });
