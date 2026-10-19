// components/modals/EditTransactionModal.tsx
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

import { Transaction } from '../../types/Transaction';
import useBanKoniStore from '../../store/useBanKoniStore';
import useTheme from '../../hooks/useTheme';

import ModalShell from '../common/overlays/ModalShell';
import ModalHeader from '../common/overlays/ModalHeader';
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
        <ModalShell visible={visible} onRequestClose={onClose}>
            <ModalHeader
                eyebrow="EDIT RECORD"
                title={type === 'CREDIT' ? 'Edit Income' : 'Edit Expense'}
                onClose={onClose}
            />

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
        </ModalShell>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
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
