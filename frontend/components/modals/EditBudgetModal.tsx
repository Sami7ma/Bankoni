// components/modals/EditBudgetModal.tsx
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, KeyboardAvoidingView, Platform, Pressable, } from 'react-native';

import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import { Budget } from '../../types/Budget';

import CloseButton from '../common/buttons/CloseButton';
import AmountInput from '../common/inputs/AmountInput';
import CategoryPicker from '../common/selectors/CategoryPicker';
import WalletPicker from '../common/selectors/WalletPicker';
import PeriodSelector from '../common/selectors/PeriodSelector';
import PrimaryButton from '../common/buttons/PrimaryButton';

interface EditBudgetModalProps {
    visible: boolean;
    budget: Budget | null;
    onClose: () => void;
}

type BudgetPeriod = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';

export default function EditBudgetModal({
    visible,
    budget,
    onClose,
}: EditBudgetModalProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    const categories = useBanKoniStore((state) => state.categories);
    const budgets = useBanKoniStore((state) => state.budgets);
    const wallets = useBanKoniStore((state) => state.wallets);
    const updateBudget = useBanKoniStore((state) => state.updateBudget);

    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
    const [limitAmount, setLimitAmount] = useState('');
    const [period, setPeriod] = useState<BudgetPeriod>('monthly');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    useEffect(() => {
        if (budget && visible) {
            setSelectedCategoryId(budget.categoryId);
            setSelectedWalletId(budget.walletId || null);
            setLimitAmount(budget.limitAmount.toString());
            const p = budget.recurring === 'none' ? 'custom' : (budget.recurring as BudgetPeriod);
            setPeriod(p || 'monthly');
            setStartDate(budget.startDate);
            setEndDate(budget.endDate);
        }
    }, [budget, visible]);

    const recurring = period === 'custom' ? 'none' : period;

    const availableCategories = categories.filter((cat) => {
        if (cat.flow !== 'EXPENSE') return false;
        if (budget && cat.id === budget.categoryId) return true;
        return !budgets.some((b) => b.categoryId === cat.id);
    });

    const handleSubmit = () => {
        if (!budget) return;
        const numAmount = parseFloat(limitAmount);

        if (isNaN(numAmount) || numAmount <= 0) {
            alert('Please enter a valid budget amount');
            return;
        }
        if (!selectedCategoryId) {
            alert('Please select a category');
            return;
        }
        if (endDate < startDate) {
            alert('End date cannot be before start date');
            return;
        }

        updateBudget(budget.id, {
            categoryId: selectedCategoryId,
            limitAmount: numAmount,
            recurring: recurring,
            startDate,
            endDate,
            walletId: selectedWalletId || null,
        });

        onClose();
    };

    if (!budget) return null;

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
                                <Text style={styles.headerEyebrow}>EDIT BUDGET</Text>
                                <Text style={styles.headerTitle}>Update Spending Limit</Text>
                            </View>
                            <CloseButton onPress={onClose} />
                        </View>

                        {/* FORM */}
                        <ScrollView
                            contentContainerStyle={styles.form}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                        >
                            {/* CATEGORY */}
                            <CategoryPicker
                                categories={availableCategories}
                                selectedId={selectedCategoryId}
                                onSelect={setSelectedCategoryId}
                                placeholder="Choose a category"
                                flow="EXPENSE"
                            />

                            {/* WALLET SELECTION (OPTIONAL / ALL WALLETS) */}
                            <WalletPicker
                                wallets={wallets}
                                selectedId={selectedWalletId}
                                onSelect={setSelectedWalletId}
                                allowAll={true}
                                allLabel="All Wallets"
                                label="Apply to Wallet"
                            />

                            {/* AMOUNT */}
                            <View style={styles.fieldGroup}>
                                <Text style={styles.label}>Budget Limit</Text>
                                <AmountInput
                                    value={limitAmount}
                                    onChangeText={setLimitAmount}
                                    variant="compact"
                                />
                            </View>

                            {/* PERIOD + DATE RANGE */}
                            <PeriodSelector
                                startDate={startDate}
                                endDate={endDate}
                                period={period}
                                onStartDateChange={setStartDate}
                                onEndDateChange={setEndDate}
                                onPeriodChange={setPeriod}
                            />

                            {/* SUBMIT */}
                            <PrimaryButton
                                label="Save Changes"
                                onPress={handleSubmit}
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
            paddingTop: 18,
            paddingBottom: 14,
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
            fontSize: 20,
            fontWeight: '700',
            color: colors.textPrimary,
        },
        form: {
            padding: 18,
            gap: 18,
        },
        fieldGroup: {
            gap: 6,
        },
        label: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
        },
    });
