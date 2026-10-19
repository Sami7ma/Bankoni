// components/modals/EditTransactionModal.tsx
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, KeyboardAvoidingView, Platform, Pressable, } from 'react-native';

import { Transaction } from '../../types/Transaction';
import useBanKoniStore from '../../store/useBanKoniStore';
import useTheme from '../../hooks/useTheme';

import CloseButton from '../common/buttons/CloseButton';
import AmountInput from '../common/inputs/AmountInput';
import CategoryPicker from '../common/selectors/CategoryPicker';
import WalletPicker from '../common/selectors/WalletPicker';
import NoteInput from '../common/inputs/NoteInput';
import PrimaryButton from '../common/buttons/PrimaryButton';

interface EditTransactionModalProps {
    visible: boolean;
    transaction: Transaction | null;
    onClose: () => void;
}

export default function EditTransactionModal({
    visible,
    transaction,
    onClose,
}: EditTransactionModalProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    const categories = useBanKoniStore((state) => state.categories);
    const wallets = useBanKoniStore((state) => state.wallets);
    const updateTransaction = useBanKoniStore((state) => state.updateTransaction);

    const [type, setType] = useState<'CREDIT' | 'DEBIT'>('DEBIT');
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
    const [selectedWalletId, setSelectedWalletId] = useState<string>('');

    useEffect(() => {
        if (transaction && visible) {
            setType(transaction.type);
            setAmount(transaction.amount.toString());
            setNote(transaction.note || '');
            setSelectedCategoryId(transaction.categoryId);
            setSelectedWalletId(transaction.walletId || '');
        }
    }, [transaction, visible]);

    const filteredCategories = categories.filter((category) =>
        type === 'DEBIT'
            ? category.flow === 'EXPENSE'
            : category.flow === 'INCOME'
    );

    const handleSubmit = () => {
        if (!transaction) return;
        const numAmount = parseFloat(amount);

        if (isNaN(numAmount) || numAmount <= 0 || !amount.trim()) {
            alert('Please enter a valid amount');
            return;
        }
        if (!selectedCategoryId) {
            alert('Please select a category');
            return;
        }
        if (!selectedWalletId) {
            alert('Please select a wallet / account');
            return;
        }

        updateTransaction(transaction.id, {
            type,
            amount: numAmount,
            categoryId: selectedCategoryId,
            walletId: selectedWalletId,
            note: note.trim() || undefined,
        });

        onClose();
    };

    if (!transaction) return null;

    const accentColor = type === 'CREDIT' ? colors.success : colors.danger;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <View style={styles.modalRoot}>
                {/* Backdrop */}
                <Pressable style={styles.backdrop} onPress={onClose} />

                {/* Centered Floating Card */}
                <KeyboardAvoidingView
                    style={styles.keyboardLayer}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <View style={styles.container}>
                        {/* Subtle inner glass highlight */}
                        <View pointerEvents="none" style={styles.glassHighlight} />

                        {/* HEADER */}
                        <View style={styles.header}>
                            <View>
                                <Text style={styles.headerEyebrow}>EDIT RECORD</Text>
                                <Text style={styles.headerTitle}>
                                    {type === 'CREDIT' ? 'Edit Income' : 'Edit Expense'}
                                </Text>
                            </View>
                            <CloseButton onPress={onClose} />
                        </View>

                        {/* FORM */}
                        <ScrollView
                            style={styles.scroll}
                            contentContainerStyle={styles.form}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                        >
                            {/* TYPE TOGGLE */}
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
                                    <View style={[styles.typeDot, { backgroundColor: colors.danger }]} />
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
                                    <View style={[styles.typeDot, { backgroundColor: colors.success }]} />
                                    <Text
                                        style={[
                                            styles.toggleText,
                                            {
                                                color: type === 'CREDIT'
                                                    ? colors.success
                                                    : colors.textSecondary,
                                            },
                                        ]}
                                    >
                                        Income
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            {/* AMOUNT */}
                            <AmountInput
                                value={amount}
                                onChangeText={setAmount}
                                variant="large"
                            />

                            {/* CATEGORY */}
                            <CategoryPicker
                                categories={filteredCategories}
                                selectedId={selectedCategoryId}
                                onSelect={setSelectedCategoryId}
                                placeholder="Select a category"
                                flow={type === 'DEBIT' ? 'EXPENSE' : 'INCOME'}
                            />

                            {/* WALLET / ACCOUNT */}
                            <WalletPicker
                                wallets={wallets}
                                selectedId={selectedWalletId}
                                onSelect={(id) => setSelectedWalletId(id || '')}
                                label={type === 'CREDIT' ? 'Deposit Into' : 'Pay From'}
                            />

                            {/* NOTE */}
                            <NoteInput
                                value={note}
                                onChangeText={setNote}
                            />

                            {/* SUBMIT */}
                            <PrimaryButton
                                label="Save Changes"
                                onPress={handleSubmit}
                                color={accentColor}
                            />
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        modalRoot: {
            flex: 1,
        },
        backdrop: {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            backgroundColor: colors.overlay,
        },
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
            shadowOffset: { width: 0, height: 15 },
            shadowOpacity: 0.35,
            shadowRadius: 35,
            elevation: 25,
        },
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
        scroll: {
            flexGrow: 0,
        },
        form: {
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 20,
            gap: 18,
        },
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
            width: 8,
            height: 8,
            borderRadius: 4,
        },
        toggleText: {
            fontSize: 14,
            fontWeight: '600',
        },
    });
