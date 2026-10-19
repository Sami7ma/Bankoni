// components/modals/EditBudgetModal.tsx
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import { Budget, BudgetPeriod } from '../../types/Budget';

import ModalShell from '../common/overlays/ModalShell';
import ModalHeader from '../common/overlays/ModalHeader';
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
        <ModalShell visible={visible} onRequestClose={onClose}>
            <ModalHeader eyebrow="EDIT BUDGET" title="Update Spending Limit" onClose={onClose} />

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
        </ModalShell>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
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
