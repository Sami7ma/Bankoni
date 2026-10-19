// components/modals/AddTransactionModal.tsx
//
// BanKoni — Add Income / Add Expense modal
//
// NOW USES REUSABLE COMPONENTS:
// - CloseButton     → modal header X button
// - AmountInput     → ETB amount field (large variant)
// - CategoryPicker  → dropdown category selector
// - NoteInput       → optional note text area
// - PrimaryButton   → submit button
//
// Styles that were moved INTO those components
// have been REMOVED from this file's stylesheet.

import React, { useEffect, useState } from 'react';

import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Modal,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    Pressable,
} from 'react-native';

import { Transaction } from '../../types/Transaction';
import useBanKoniStore from '../../store/useBanKoniStore';
import useTheme from '../../hooks/useTheme';

// ── REUSABLE COMPONENTS ──────────────────────────────────
// These used to be inline JSX + styles in this file.
// Now they're shared components used by multiple screens.
import CloseButton from '../common/buttons/CloseButton';
import AmountInput from '../common/inputs/AmountInput';
import CategoryPicker from '../common/selectors/CategoryPicker';
import WalletPicker from '../common/selectors/WalletPicker';
import NoteInput from '../common/inputs/NoteInput';
import PrimaryButton from '../common/buttons/PrimaryButton';

// PROPS
interface AddTransactionModalProps {
    visible: boolean;
    onClose: () => void;
    defaultType: 'CREDIT' | 'DEBIT';
}

// COMPONENT
export default function AddTransactionModal({ visible, onClose, defaultType, }: AddTransactionModalProps) {
    // THEME
    const colors = useTheme();
    // Styles must be created using the current theme.
    const styles = createStyles(colors);

    // ZUSTAND
    const categories = useBanKoniStore((state) => state.categories);
    const addTransaction = useBanKoniStore((state) => state.addTransaction);
    const wallets = useBanKoniStore((state) => state.wallets);

    // FORM STATE
    const [type, setType] = useState<'CREDIT' | 'DEBIT'>(defaultType);
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
    const [selectedWalletId, setSelectedWalletId] = useState<string>('');

    // RESET FORM
    useEffect(() => {
        if (visible) {
            setType(defaultType);
            setAmount('');
            setNote('');
            setSelectedCategoryId('');
            const activeWallets = wallets.filter((w) => !w.isArchived);
            const defaultWallet = activeWallets.find((w) => w.isDefault) || activeWallets[0];
            setSelectedWalletId(defaultWallet?.id || '');
        }
    }, [defaultType, visible, wallets]);

    // CATEGORY    
    const filteredCategories = categories.filter((category) =>
        type === 'DEBIT'
            ? category.flow === 'EXPENSE'
            : category.flow === 'INCOME'
    );

    // SUBMIT
    const handleSubmit = async () => {
        const numAmount = parseFloat(amount);
        // Validate amount
        if (isNaN(numAmount) || numAmount <= 0 || !amount.trim()) {
            alert('Please enter a valid amount');
            return;
        }
        // Validate category
        if (!selectedCategoryId) {
            alert('Please select a category');
            return;
        }
        // Validate wallet
        if (!selectedWalletId) {
            alert('Please select a wallet / account');
            return;
        }

        const now = new Date().toISOString();
        const newTransaction = {
            amount: numAmount,
            type,
            categoryId: selectedCategoryId,
            walletId: selectedWalletId,
            date: now,
            note: note.trim() || undefined,
            status: 'CLEARED' as const,
        };

        try {
            await addTransaction(newTransaction);
            onClose();
        } catch (error) {
            alert('Failed to save transaction. Please try again.');
        }
    };

    // CURRENT TYPE COLOR

    const accentColor = type === 'CREDIT'
        ? colors.success
        : colors.danger;


    // UI
    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent
        >

            {/* Full screen modal layer */}
            <View style={styles.modalRoot}>
                {/* Dark / glass backdrop */}
                <Pressable
                    style={styles.backdrop}
                    onPress={onClose}
                />

                {/* Keyboard handling */}
                <KeyboardAvoidingView
                    style={styles.keyboardLayer}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >

                    {/* FLOATING GLASS CARD */}
                    <View style={styles.container}>
                        {/* Inner glass highlight */}
                        <View
                            pointerEvents="none"
                            style={styles.glassHighlight}
                        />

                        {/* HEADER*/}
                        <View style={styles.header}>
                            <View>
                                <Text style={styles.headerEyebrow}>
                                    TRANSACTION
                                </Text>

                                <Text style={styles.headerTitle}>
                                    {type === 'CREDIT' ? 'Add Income' : 'Add Expense'}
                                </Text>
                            </View>

                            {/* ← Was ~8 lines of inline TouchableOpacity + X icon.
                                Now it's one component! */}
                            <CloseButton onPress={onClose} />

                        </View>

                        {/* FORM */}
                        <ScrollView
                            style={styles.scroll}
                            contentContainerStyle={styles.form}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                        >

                            {/* TYPE TOGGLE*/}
                            <View style={styles.toggleContainer}>
                                <TouchableOpacity
                                    activeOpacity={0.8}
                                    onPress={() => {
                                        setType('DEBIT');
                                        setSelectedCategoryId('');
                                    }}
                                    style={[
                                        styles.toggleButton,
                                        type === 'DEBIT' && {
                                            borderColor: colors.danger,
                                            backgroundColor: colors.danger + '10',
                                        },
                                    ]}
                                >
                                    <View style={[styles.typeDot, { backgroundColor: colors.danger, }]} />
                                    <Text
                                        style={[
                                            styles.toggleText,
                                            {
                                                color: type === 'DEBIT'
                                                    ? colors.danger
                                                    : colors.textSecondary,
                                            },
                                        ]}
                                    >
                                        Expense
                                    </Text>

                                </TouchableOpacity>


                                <TouchableOpacity
                                    activeOpacity={0.8}
                                    onPress={() => {
                                        setType('CREDIT');
                                        setSelectedCategoryId('');
                                    }}
                                    style={[
                                        styles.toggleButton,
                                        type === 'CREDIT' && {
                                            borderColor: colors.success,
                                            backgroundColor: colors.success + '10',
                                        },
                                    ]}
                                >

                                    <View style={[styles.typeDot, { backgroundColor: colors.success, }]} />

                                    <Text style={[
                                        styles.toggleText,
                                        {
                                            color: type === 'CREDIT'
                                                ? colors.success
                                                : colors.textSecondary,
                                        },
                                    ]}>
                                        Income
                                    </Text>

                                </TouchableOpacity>

                            </View>


                            {/* AMOUNT — was ~15 lines, now 1 component */}
                            <AmountInput
                                value={amount}
                                onChangeText={setAmount}
                                variant="large"
                                autoFocus
                            />

                            {/* CATEGORY — was ~60 lines, now 1 component */}
                            <CategoryPicker
                                categories={filteredCategories}
                                selectedId={selectedCategoryId}
                                onSelect={setSelectedCategoryId}
                                placeholder="Select a category"
                                flow={type === 'DEBIT' ? 'EXPENSE' : 'INCOME'}
                            />

                            {/* WALLET / ACCOUNT PICKER */}
                            <WalletPicker
                                wallets={wallets}
                                selectedId={selectedWalletId}
                                onSelect={(id) => setSelectedWalletId(id || '')}
                                label={type === 'CREDIT' ? 'Deposit Into' : 'Pay From'}
                            />

                            {/* NOTE — was ~15 lines, now 1 component */}
                            <NoteInput
                                value={note}
                                onChangeText={setNote}
                            />

                            {/* SUBMIT — was ~10 lines, now 1 component */}
                            <PrimaryButton
                                label={type === 'CREDIT' ? 'Add Income' : 'Add Expense'}
                                onPress={handleSubmit}
                                color={accentColor}
                            />

                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </View >
        </Modal >
    );
}
// STYLES
// ─────────────────────────────────────────────────────────
// CLEANED UP: Removed all styles that now live inside
// the reusable components:
// - closeButton       → CloseButton component
// - amountSection, currency, amountInput → AmountInput component
// - selectorButton, selectorText, categoryList,
//   categoryItem, categoryItemText → CategoryPicker component
// - noteInput         → NoteInput component
// - submitButton, submitText → PrimaryButton component

const createStyles = (colors: ReturnType<typeof useTheme>) => StyleSheet.create({
    // Full screen transparent modal.
    modalRoot: {
        flex: 1,
    },
    // This is what keeps HomeScreen visible behind
    // the floating form.
    backdrop: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: colors.overlay,
    },
    // Centers the floating form.
    keyboardLayer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        paddingVertical: 24,
    },

    container: {
        width: '100%',
        maxWidth: 500,
        maxHeight: '88%',
        backgroundColor: colors.surface + 'F2',
        borderColor: colors.champagne + '55',
        borderRadius: 30,
        borderWidth: 1,
        overflow: 'hidden',
        shadowOffset: { width: 0, height: 15, },
        shadowOpacity: 0.35,
        shadowRadius: 35,
        elevation: 25,
    },
    // Very subtle inner glass border.
    glassHighlight: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        borderRadius: 30,
        borderWidth: 1,
        pointerEvents: 'none',
        borderColor: colors.champagne + '18',
    },

    // HEADER
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 18,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    headerEyebrow: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1.5,
        color: colors.champagne,
        marginBottom: 4,
    },
    headerTitle: {
        fontSize: 21,
        fontWeight: '700',
        color: colors.textPrimary,
        letterSpacing: -0.3,
    },
    // SCROLL
    scroll: {
        flexGrow: 0,
    },
    form: {
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 20,
        gap: 18,
    },
    // TYPE TOGGLE
    toggleContainer: {
        flexDirection: 'row',
        gap: 10,
    },
    toggleButton: {
        flex: 1,
        minHeight: 48,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceAlt,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    typeDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    toggleText: {
        fontSize: 14,
        fontWeight: '600',
    },
    // FIELDS — only the label + fieldGroup remain
    // (everything else moved to components)
    fieldGroup: {
        gap: 8,
    },
    label: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1,
        color: colors.textSecondary,
        textTransform: 'uppercase',
    },
});