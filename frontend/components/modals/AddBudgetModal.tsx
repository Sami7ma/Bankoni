// components/modals/AddBudgetModal.tsx
//
// Modal form for creating a new budget.
//
// NOW USES REUSABLE COMPONENTS:
// - CloseButton      → modal header X button
// - AmountInput      → ETB budget limit (compact variant)
// - CategoryPicker   → expense category dropdown
// - PeriodSelector   → period wheel + calendar + date range
// - PrimaryButton    → "Create Budget" submit button
//
// All date/period logic has been moved into PeriodSelector.
// All duplicate styles have been removed from this file.

import { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
} from 'react-native';

// hooks
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import { BudgetPeriod } from '../../types/Budget';

import ModalShell from '../common/overlays/ModalShell';
import ModalHeader from '../common/overlays/ModalHeader';
import AmountInput from '../common/inputs/AmountInput';
import CategoryPicker from '../common/selectors/CategoryPicker';
import WalletPicker from '../common/selectors/WalletPicker';
import PeriodSelector from '../common/selectors/PeriodSelector';
import PrimaryButton from '../common/buttons/PrimaryButton';

// types
interface AddBudgetModalProps {
    visible: boolean;
    onClose: () => void;
}

export default function AddBudgetModal({
    visible,
    onClose,
}: AddBudgetModalProps) {
    // THEME
    const colors = useTheme();
    const styles = createStyles(colors);

    // ZUSTAND
    const categories = useBanKoniStore((state) => state.categories);
    const budgets = useBanKoniStore((state) => state.budgets);
    const wallets = useBanKoniStore((state) => state.wallets);
    const addBudget = useBanKoniStore((state) => state.addBudget);

    // LOCAL STATE — only the form fields remain here.
    // Date/period state is now managed inside PeriodSelector.
    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
    const [limitAmount, setLimitAmount] = useState('');
    const [period, setPeriod] = useState<BudgetPeriod>('monthly');
    const [startDate, setStartDate] = useState(
        new Date().toISOString().split('T')[0]
    );
    const [endDate, setEndDate] = useState(
        new Date().toISOString().split('T')[0]
    );

    // Recurring value for the store
    // 'custom' means no recurring — the user picked specific dates
    const recurring = period === 'custom' ? 'none' : period;

    // AVAILABLE CATEGORIES
    // Only expense categories, excluding already-budgeted ones
    const availableCategories = categories.filter((cat) => {
        if (cat.flow !== 'EXPENSE') return false;
        return !budgets.some((b) => b.categoryId === cat.id);
    });

    // RESET FORM
    const resetForm = () => {
        setSelectedCategoryId('');
        setSelectedWalletId(null);
        setLimitAmount('');
        setPeriod('monthly');
        const today = new Date().toISOString().split('T')[0];
        setStartDate(today);
        setEndDate(today);
    };

    // SUBMIT
    const handleSubmit = async () => {
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
            alert('End date cannot be before the start date');
            return;
        }

        try {
            await addBudget({
                categoryId: selectedCategoryId,
                limitAmount: numAmount,
                recurring: recurring,
                startDate,
                endDate,
                walletId: selectedWalletId || null,
            });
            resetForm();
            onClose();
        } catch (error) {
            alert('Failed to save budget. Please try again.');
        }

    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    // UI
    return (
        <ModalShell visible={visible} onRequestClose={handleClose}>
            <ModalHeader eyebrow="NEW BUDGET" title="Set Spending Limit" onClose={handleClose} />

            {/* FORM */}
            <ScrollView
                contentContainerStyle={styles.form}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* CATEGORY — was ~60 lines of inline JSX */}
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

                {/* AMOUNT — was ~15 lines of inline JSX */}
                <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Budget Limit</Text>
                    <AmountInput
                        value={limitAmount}
                        onChangeText={setLimitAmount}
                        variant="compact"
                    />
                </View>

                {/* PERIOD + DATE RANGE — was ~300 lines! 
                    Now all handled by PeriodSelector */}
                <PeriodSelector
                    startDate={startDate}
                    endDate={endDate}
                    period={period}
                    onStartDateChange={setStartDate}
                    onEndDateChange={setEndDate}
                    onPeriodChange={setPeriod}
                />

                {/* SUBMIT — was ~8 lines of inline JSX */}
                <PrimaryButton
                    label="Create Budget"
                    onPress={handleSubmit}
                />
            </ScrollView>
        </ModalShell>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        // FORM
        form: {
            padding: 15,
            gap: 17,
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