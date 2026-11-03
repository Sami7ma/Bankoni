// components/modals/AddTransactionModal.tsx
//
// BanKoni — Add Income / Add Expense modal
//
// NOW USES REUSABLE COMPONENTS:
// - ModalShell / ModalHeader → shared overlay shell and header (incl. close button)
// - AmountInput     → ETB amount field (large variant)
// - CategoryPicker  → dropdown category selector
// - NoteInput       → optional note text area
// - PrimaryButton   → submit button
//
// Styles that were moved INTO those components
// have been REMOVED from this file's stylesheet.

import { useEffect, useState } from 'react';

import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    TextInput,
    Alert,
} from 'react-native';
import {
    MessageSquareText,
    ArrowLeftRight,
    Users,
    Check,
    Trash2,
    ChevronDown,
    Plus,
    Building2,
    AlertTriangle,
    ShieldCheck,
} from 'lucide-react-native';
import * as Crypto from 'expo-crypto';

import useBanKoniStore from '../../store/useBanKoniStore';
import useTheme from '../../hooks/useTheme';
import WalletLogo from '../wallets/WalletLogo';
import { maskAccountIdentifier } from '../../utils/accountRegistry';
import { formatEtb } from '../../utils/format';

// ── REUSABLE COMPONENTS ──────────────────────────────────
import ModalShell from '../common/overlays/ModalShell';
import ModalHeader from '../common/overlays/ModalHeader';
import AmountInput from '../common/inputs/AmountInput';
import CategoryPicker from '../common/selectors/CategoryPicker';
import WalletPicker from '../common/selectors/WalletPicker';
import NoteInput from '../common/inputs/NoteInput';
import PrimaryButton from '../common/buttons/PrimaryButton';

// PROPS
interface AddTransactionModalProps {
    visible: boolean;
    onClose: () => void;
    defaultType: 'CREDIT' | 'DEBIT' | 'TRANSFER';
    onOpenSmsImport?: () => void;
}

// COMPONENT
export default function AddTransactionModal({
    visible,
    onClose,
    defaultType,
    onOpenSmsImport,
}: AddTransactionModalProps) {
    // THEME
    const colors = useTheme();
    const styles = createStyles(colors);

    // ZUSTAND
    const categories = useBanKoniStore((state) => state.categories);
    const addTransaction = useBanKoniStore((state) => state.addTransaction);
    const wallets = useBanKoniStore((state) => state.wallets);
    const createTransfer = useBanKoniStore((state) => state.createTransfer);
    const createSharedExpense = useBanKoniStore((state) => state.createSharedExpense);
    const allocateReimbursement = useBanKoniStore((state) => state.allocateReimbursement);
    const sharedExpenses = useBanKoniStore((state) => state.sharedExpenses);
    const knownAccounts = useBanKoniStore((state) => state.knownAccounts);
    const saveKnownAccount = useBanKoniStore((state) => state.saveKnownAccount);

    // FORM STATE
    const [type, setType] = useState<'CREDIT' | 'DEBIT' | 'TRANSFER'>(defaultType);
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
    const [selectedWalletId, setSelectedWalletId] = useState<string>('');
    const [targetWalletId, setTargetWalletId] = useState<string>('');
    const [feeAmount, setFeeAmount] = useState('');

    // Transfer Known Account Selection state
    const [fromAccountId, setFromAccountId] = useState<string>('');
    const [toAccountId, setToAccountId] = useState<string>('');
    const [isFromPickerOpen, setIsFromPickerOpen] = useState(false);
    const [isToPickerOpen, setIsToPickerOpen] = useState(false);
    const [isEnteringNewAccount, setIsEnteringNewAccount] = useState(false);
    const [newAccountNumber, setNewAccountNumber] = useState('');
    const [newAccountName, setNewAccountName] = useState('');
    const [newAccountProvider, setNewAccountProvider] = useState('cbe');
    const [newAccountOwnership, setNewAccountOwnership] = useState<'OWN' | 'EXTERNAL'>('OWN');
    const [saveToKnownAccounts, setSaveToKnownAccounts] = useState(true);

    // Shared expense state
    const [isSplitExpense, setIsSplitExpense] = useState(false);
    const [personalShare, setPersonalShare] = useState('');
    const [participants, setParticipants] = useState<Array<{ name: string; amount: string }>>([
        { name: '', amount: '' },
    ]);

    // Reimbursement state
    const [isReimbursement, setIsReimbursement] = useState(false);
    const [selectedSharedExpenseId, setSelectedSharedExpenseId] = useState('');
    const [selectedParticipantId, setSelectedParticipantId] = useState<string>('');

    // Active pending shared expenses available for reimbursement
    const pendingSharedExpenses = sharedExpenses.filter(
        (se) => se.outstandingReceivable > 0
    );

    // Combine Known Accounts with Wallets to ensure full registry access
    const accountsList: Array<{
        id: string;
        displayName: string;
        maskedIdentifier: string;
        provider: string;
        ownership: 'OWN' | 'EXTERNAL';
        linkedWalletId?: string;
    }> = [
        ...knownAccounts.map((acc) => ({
            id: acc.id,
            displayName: acc.displayName,
            maskedIdentifier: acc.maskedIdentifier || acc.accountNumber,
            provider: acc.providerId,
            ownership: acc.ownership,
            linkedWalletId: acc.walletId,
        })),
        ...wallets
            .filter((w) => !w.isArchived && !knownAccounts.some((ka) => ka.walletId === w.id))
            .map((w) => ({
                id: `wallet-${w.id}`,
                displayName: w.name,
                maskedIdentifier: w.accountNumberLast4 ? `Ending ${w.accountNumberLast4}` : 'Wallet',
                provider: w.providerId || 'telebirr',
                ownership: 'OWN' as const,
                linkedWalletId: w.id,
            })),
    ];

    const selectedFromAccount = accountsList.find((a) => a.id === fromAccountId);
    const selectedToAccount = !isEnteringNewAccount ? accountsList.find((a) => a.id === toAccountId) : null;
    const isSameAccount =
        type === 'TRANSFER' &&
        !isEnteringNewAccount &&
        Boolean(
            fromAccountId &&
                toAccountId &&
                (fromAccountId === toAccountId ||
                    (selectedFromAccount?.linkedWalletId &&
                        selectedToAccount?.linkedWalletId &&
                        selectedFromAccount.linkedWalletId === selectedToAccount.linkedWalletId))
        );

    const principalNum = parseFloat(amount) > 0 ? parseFloat(amount) : 0;
    const transferFeeNum = parseFloat(feeAmount) > 0 ? parseFloat(feeAmount) : 0;
    const totalDebitCalc = principalNum + transferFeeNum;

    // RESET FORM
    useEffect(() => {
        if (visible) {
            setType(defaultType);
            setAmount('');
            setNote('');
            setSelectedCategoryId('');
            setFeeAmount('');
            setIsSplitExpense(false);
            setPersonalShare('');
            setParticipants([{ name: '', amount: '' }]);
            setIsReimbursement(false);
            setSelectedSharedExpenseId('');
            setSelectedParticipantId('');

            const activeWallets = wallets.filter((w) => !w.isArchived);
            const defaultWallet = activeWallets.find((w) => w.isDefault) || activeWallets[0];
            setSelectedWalletId(defaultWallet?.id || '');
            const otherWallet = activeWallets.find((w) => w.id !== defaultWallet?.id) || activeWallets[0];
            setTargetWalletId(otherWallet?.id || '');

            const ownAccounts = accountsList.filter((a) => a.ownership === 'OWN');
            const defaultAcc = ownAccounts.find((a) => a.linkedWalletId === defaultWallet?.id) || ownAccounts[0] || accountsList[0];
            const secondAcc = ownAccounts.find((a) => a.id !== defaultAcc?.id) || accountsList.find((a) => a.id !== defaultAcc?.id);
            setFromAccountId(defaultAcc?.id || '');
            setToAccountId(secondAcc?.id || '');
            setIsFromPickerOpen(false);
            setIsToPickerOpen(false);
            setIsEnteringNewAccount(false);
            setNewAccountNumber('');
            setNewAccountName('');
            setNewAccountProvider('cbe');
            setNewAccountOwnership('OWN');
            setSaveToKnownAccounts(true);
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
        if (isNaN(numAmount) || numAmount <= 0 || !amount.trim()) {
            Alert.alert('Invalid Amount', 'Please enter a valid amount');
            return;
        }

        if (type === 'TRANSFER') {
            if (isSameAccount) {
                Alert.alert('Invalid Transfer', 'Source and destination accounts must be different.');
                return;
            }

            const fromAccount = accountsList.find((a) => a.id === fromAccountId);
            const sourceWallet =
                wallets.find((w) => w.id === fromAccount?.linkedWalletId) ||
                wallets.find((w) => w.id === selectedWalletId) ||
                wallets[0];

            if (!sourceWallet) {
                Alert.alert('Missing Source Wallet', 'Please select a source account backed by an active wallet.');
                return;
            }

            let destinationName = '';
            let destWalletId: string | undefined = undefined;

            if (isEnteringNewAccount) {
                if (!newAccountNumber.trim()) {
                    Alert.alert('Missing Account', 'Please enter the destination account or phone number.');
                    return;
                }
                destinationName = newAccountName.trim() || newAccountNumber.trim();
                if (saveToKnownAccounts) {
                    await saveKnownAccount({
                        id: Crypto.randomUUID(),
                        accountNumber: newAccountNumber.trim(),
                        accountLast4: newAccountNumber.trim().slice(-4),
                        displayName: destinationName,
                        maskedIdentifier: maskAccountIdentifier(newAccountNumber.trim()),
                        providerId: newAccountProvider,
                        ownership: newAccountOwnership,
                        accountType:
                            newAccountProvider === 'telebirr' || newAccountProvider === 'cbe_birr'
                                ? 'mobile_money'
                                : 'bank',
                        createdAt: new Date().toISOString(),
                    });
                }
            } else {
                const toAccount = accountsList.find((a) => a.id === toAccountId);
                if (!toAccount) {
                    Alert.alert('Missing Destination', 'Please select a destination account.');
                    return;
                }
                destinationName = toAccount.displayName;
                destWalletId = toAccount.linkedWalletId;
            }

            const feeNum = parseFloat(feeAmount) || 0;
            if (feeNum < 0) {
                Alert.alert('Invalid Fee', 'Transfer fee cannot be negative.');
                return;
            }

            try {
                if (destWalletId) {
                    // Internal transfer between user's own wallets
                    await createTransfer({
                        fromWalletId: sourceWallet.id,
                        toWalletId: destWalletId,
                        amount: numAmount,
                        feeAmount: feeNum > 0 ? feeNum : undefined,
                        note: note.trim() || undefined,
                    });
                } else {
                    // Outgoing transfer to external recipient/account
                    const outTxId = Crypto.randomUUID();
                    await addTransaction({
                        id: outTxId,
                        amount: numAmount,
                        type: 'DEBIT',
                        subType: 'TRANSFER',
                        isTransfer: true,
                        categoryId: 'cat-1',
                        walletId: sourceWallet.id,
                        date: new Date().toISOString(),
                        note: note.trim() || `Transfer to ${destinationName}`,
                        counterparty: destinationName,
                        feeAmount: feeNum > 0 ? feeNum : undefined,
                        status: 'CLEARED',
                    });
                    if (feeNum > 0) {
                        await addTransaction({
                            id: Crypto.randomUUID(),
                            amount: feeNum,
                            type: 'DEBIT',
                            subType: 'FEE',
                            categoryId: 'cat-1',
                            walletId: sourceWallet.id,
                            date: new Date().toISOString(),
                            note: `Transfer fee for transfer to ${destinationName}`,
                            status: 'CLEARED',
                        });
                    }
                }
                onClose();
            } catch (error) {
                Alert.alert('Transfer Error', 'Failed to complete transfer.');
            }
            return;
        }

        // Validate category for standard income / expense
        if (!selectedCategoryId) {
            Alert.alert('Missing Category', 'Please select a category');
            return;
        }
        if (!selectedWalletId) {
            Alert.alert('Missing Account', 'Please select a wallet / account');
            return;
        }

        const now = new Date().toISOString();
        const newTxId = Crypto.randomUUID();

        if (type === 'DEBIT' && isSplitExpense) {
            const myShare = parseFloat(personalShare);
            if (isNaN(myShare) || myShare < 0) {
                Alert.alert('Invalid Share', 'Please enter a valid personal share amount.');
                return;
            }
            const validParticipants = participants
                .filter((p) => p.name.trim() && parseFloat(p.amount) > 0)
                .map((p) => ({
                    name: p.name.trim(),
                    expectedAmount: parseFloat(p.amount),
                }));

            if (validParticipants.length === 0) {
                Alert.alert('Missing Participants', 'Please add at least one participant with a valid share amount.');
                return;
            }

            try {
                await addTransaction({
                    id: newTxId,
                    amount: numAmount,
                    type: 'DEBIT',
                    subType: 'SHARED_EXPENSE',
                    categoryId: selectedCategoryId,
                    walletId: selectedWalletId,
                    date: now,
                    note: note.trim() || undefined,
                    status: 'CLEARED',
                });

                await createSharedExpense({
                    transactionId: newTxId,
                    totalAmount: numAmount,
                    personalShare: myShare,
                    description: note.trim() || undefined,
                    participants: validParticipants,
                });

                onClose();
            } catch (err) {
                Alert.alert('Error', 'Failed to save split expense.');
            }
            return;
        }

        if (type === 'CREDIT' && isReimbursement && selectedSharedExpenseId) {
            try {
                await addTransaction({
                    id: newTxId,
                    amount: numAmount,
                    type: 'CREDIT',
                    subType: 'REIMBURSEMENT',
                    categoryId: selectedCategoryId,
                    walletId: selectedWalletId,
                    date: now,
                    note: note.trim() || undefined,
                    status: 'CLEARED',
                });

                await allocateReimbursement({
                    reimbursementTransactionId: newTxId,
                    sharedExpenseId: selectedSharedExpenseId,
                    participantId: selectedParticipantId || undefined,
                    allocatedAmount: numAmount,
                });

                onClose();
            } catch (err) {
                Alert.alert('Error', 'Failed to save reimbursement.');
            }
            return;
        }

        // Standard transaction
        try {
            await addTransaction({
                id: newTxId,
                amount: numAmount,
                type,
                subType: 'STANDARD',
                categoryId: selectedCategoryId,
                walletId: selectedWalletId,
                date: now,
                note: note.trim() || undefined,
                status: 'CLEARED',
            });
            onClose();
        } catch (error) {
            Alert.alert('Error', 'Failed to save transaction. Please try again.');
        }
    };

    // CURRENT TYPE COLOR
    const accentColor =
        type === 'CREDIT'
            ? colors.success
            : type === 'TRANSFER'
            ? colors.champagne
            : colors.danger;

    // UI
    return (
        <ModalShell visible={visible} onRequestClose={onClose}>
            <ModalHeader
                eyebrow="TRANSACTION"
                title={
                    type === 'CREDIT'
                        ? 'Add Income'
                        : type === 'TRANSFER'
                        ? 'Transfer Funds'
                        : 'Add Expense'
                }
                onClose={onClose}
                rightAction={
                    onOpenSmsImport ? (
                        <TouchableOpacity
                            style={styles.headerImportButton}
                            onPress={() => {
                                onClose();
                                onOpenSmsImport();
                            }}
                            activeOpacity={0.75}
                            accessibilityLabel="Import SMS"
                            accessibilityRole="button"
                        >
                            <MessageSquareText size={14} color={colors.champagne} />
                            <Text style={styles.headerImportButtonText}>Import SMS</Text>
                        </TouchableOpacity>
                    ) : null
                }
            />

            {/* FORM */}
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.form}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >

                {/* TYPE TOGGLE: EXPENSE | INCOME | TRANSFER */}
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
                                    color:
                                        type === 'DEBIT'
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
                                    color:
                                        type === 'CREDIT'
                                            ? colors.success
                                            : colors.textSecondary,
                                },
                            ]}
                        >
                            Income
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => {
                            setType('TRANSFER');
                            setSelectedCategoryId('');
                        }}
                        style={[
                            styles.toggleButton,
                            type === 'TRANSFER' && {
                                borderColor: colors.champagne,
                                backgroundColor: colors.champagne + '10',
                            },
                        ]}
                    >
                        <View style={[styles.typeDot, { backgroundColor: colors.champagne }]} />
                        <Text
                            style={[
                                styles.toggleText,
                                {
                                    color:
                                        type === 'TRANSFER'
                                            ? colors.champagne
                                            : colors.textSecondary,
                                },
                            ]}
                        >
                            Transfer
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* AMOUNT INPUT */}
                <AmountInput
                    value={amount}
                    onChangeText={setAmount}
                    variant="large"
                />

                {/* FIELDS FOR TRANSFER */}
                {type === 'TRANSFER' ? (
                    <View style={{ gap: 14 }}>
                        {/* Source Account Selector */}
                        <View style={styles.selectorWrapper}>
                            <Text style={styles.label}>TRANSFER FROM (SOURCE ACCOUNT)</Text>
                            <TouchableOpacity
                                style={styles.accountSelectorButton}
                                onPress={() => {
                                    setIsFromPickerOpen(!isFromPickerOpen);
                                    setIsToPickerOpen(false);
                                }}
                                activeOpacity={0.8}
                            >
                                <View style={styles.accountSelectorLeft}>
                                    <WalletLogo providerId={selectedFromAccount?.provider || 'cbe'} size={26} />
                                    <View style={styles.accountInfoCol}>
                                        <Text style={styles.accountNameText} numberOfLines={1}>
                                            {selectedFromAccount?.displayName || 'Select Source Account'}
                                        </Text>
                                        <Text style={styles.accountMaskedText} numberOfLines={1}>
                                            {selectedFromAccount?.maskedIdentifier || ''}
                                        </Text>
                                    </View>
                                </View>
                                <ChevronDown size={18} color={colors.textSecondary} />
                            </TouchableOpacity>

                            {isFromPickerOpen && (
                                <View style={styles.accountDropdownList}>
                                    <ScrollView nestedScrollEnabled style={{ maxHeight: 200 }}>
                                        {accountsList
                                            .filter((acc) => acc.ownership === 'OWN')
                                            .map((acc) => {
                                                const isSelected = acc.id === fromAccountId;
                                                return (
                                                    <TouchableOpacity
                                                        key={acc.id}
                                                        style={[styles.accountOptionRow, isSelected && styles.accountOptionRowActive]}
                                                        onPress={() => {
                                                            setFromAccountId(acc.id);
                                                            if (acc.linkedWalletId) setSelectedWalletId(acc.linkedWalletId);
                                                            setIsFromPickerOpen(false);
                                                        }}
                                                        activeOpacity={0.7}
                                                    >
                                                        <WalletLogo providerId={acc.provider} size={22} />
                                                        <View style={{ flex: 1, marginLeft: 10 }}>
                                                            <Text style={[styles.accountOptionName, isSelected && { color: colors.champagne }]}>
                                                                {acc.displayName}
                                                            </Text>
                                                            <Text style={styles.accountOptionSub}>{acc.maskedIdentifier}</Text>
                                                        </View>
                                                        {isSelected && <Check size={16} color={colors.champagne} />}
                                                    </TouchableOpacity>
                                                );
                                            })}
                                    </ScrollView>
                                </View>
                            )}
                        </View>

                        {/* Destination Account Selector */}
                        <View style={styles.selectorWrapper}>
                            <Text style={styles.label}>TRANSFER TO (DESTINATION ACCOUNT)</Text>
                            {isEnteringNewAccount ? (
                                <View style={styles.newAccountCard}>
                                    <View style={styles.newAccountHeader}>
                                        <Text style={styles.newAccountTitle}>NEW DESTINATION ACCOUNT</Text>
                                        <TouchableOpacity
                                            onPress={() => setIsEnteringNewAccount(false)}
                                            style={styles.switchModeBtn}
                                        >
                                            <Text style={styles.switchModeBtnText}>Pick Known Account</Text>
                                        </TouchableOpacity>
                                    </View>

                                    <View style={{ gap: 10 }}>
                                        <TextInput
                                            style={styles.textInput}
                                            value={newAccountNumber}
                                            onChangeText={setNewAccountNumber}
                                            placeholder="Account or phone number (e.g. 1000... or 09...)"
                                            placeholderTextColor={colors.textMuted}
                                            keyboardType="phone-pad"
                                        />
                                        <TextInput
                                            style={styles.textInput}
                                            value={newAccountName}
                                            onChangeText={setNewAccountName}
                                            placeholder="Beneficiary / Account Name (optional)"
                                            placeholderTextColor={colors.textMuted}
                                        />

                                        {/* Provider Selection Chips */}
                                        <View>
                                            <Text style={styles.subLabel}>PROVIDER</Text>
                                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 4 }}>
                                                {[
                                                    { id: 'cbe', label: 'CBE' },
                                                    { id: 'telebirr', label: 'Telebirr' },
                                                    { id: 'boa', label: 'Bank of Abyssinia' },
                                                    { id: 'cbe_birr', label: 'CBE Birr' },
                                                    { id: 'dashen', label: 'Dashen' },
                                                    { id: 'awash', label: 'Awash' },
                                                ].map((prov) => (
                                                    <TouchableOpacity
                                                        key={prov.id}
                                                        style={[styles.providerChip, newAccountProvider === prov.id && styles.providerChipActive]}
                                                        onPress={() => setNewAccountProvider(prov.id)}
                                                    >
                                                        <WalletLogo providerId={prov.id} size={16} />
                                                        <Text style={[styles.providerChipText, newAccountProvider === prov.id && styles.providerChipTextActive]}>
                                                            {prov.label}
                                                        </Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </ScrollView>
                                        </View>

                                        {/* Ownership Toggle */}
                                        <View style={styles.ownershipRow}>
                                            <TouchableOpacity
                                                style={[styles.ownershipBtn, newAccountOwnership === 'OWN' && styles.ownershipBtnActive]}
                                                onPress={() => setNewAccountOwnership('OWN')}
                                            >
                                                <Text style={[styles.ownershipBtnText, newAccountOwnership === 'OWN' && styles.ownershipBtnTextActive]}>
                                                    My Own Account
                                                </Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.ownershipBtn, newAccountOwnership === 'EXTERNAL' && styles.ownershipBtnActive]}
                                                onPress={() => setNewAccountOwnership('EXTERNAL')}
                                            >
                                                <Text style={[styles.ownershipBtnText, newAccountOwnership === 'EXTERNAL' && styles.ownershipBtnTextActive]}>
                                                    Someone Else
                                                </Text>
                                            </TouchableOpacity>
                                        </View>

                                        {/* Save Checkbox */}
                                        <TouchableOpacity
                                            style={styles.checkboxRow}
                                            onPress={() => setSaveToKnownAccounts(!saveToKnownAccounts)}
                                            activeOpacity={0.8}
                                        >
                                            <View style={[styles.checkboxBox, saveToKnownAccounts && styles.checkboxBoxActive]}>
                                                {saveToKnownAccounts && <Check size={14} color="#000" />}
                                            </View>
                                            <Text style={styles.checkboxLabel}>Save to Known Accounts Registry for future transfers</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ) : (
                                <>
                                    <TouchableOpacity
                                        style={styles.accountSelectorButton}
                                        onPress={() => {
                                            setIsToPickerOpen(!isToPickerOpen);
                                            setIsFromPickerOpen(false);
                                        }}
                                        activeOpacity={0.8}
                                    >
                                        <View style={styles.accountSelectorLeft}>
                                            <WalletLogo providerId={selectedToAccount?.provider || 'telebirr'} size={26} />
                                            <View style={styles.accountInfoCol}>
                                                <Text style={styles.accountNameText} numberOfLines={1}>
                                                    {selectedToAccount?.displayName || 'Select Destination Account'}
                                                </Text>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                                    <Text style={styles.accountMaskedText} numberOfLines={1}>
                                                        {selectedToAccount?.maskedIdentifier || ''}
                                                    </Text>
                                                    {selectedToAccount && (
                                                        <View style={[styles.ownershipBadge, selectedToAccount.ownership === 'OWN' ? styles.ownershipBadgeOwn : styles.ownershipBadgeExt]}>
                                                            <Text style={[styles.ownershipBadgeText, selectedToAccount.ownership === 'OWN' ? styles.ownershipBadgeTextOwn : styles.ownershipBadgeTextExt]}>
                                                                {selectedToAccount.ownership === 'OWN' ? 'MY ACCOUNT' : 'EXTERNAL'}
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>
                                            </View>
                                        </View>
                                        <ChevronDown size={18} color={colors.textSecondary} />
                                    </TouchableOpacity>

                                    {isToPickerOpen && (
                                        <View style={styles.accountDropdownList}>
                                            <ScrollView nestedScrollEnabled style={{ maxHeight: 220 }}>
                                                {accountsList.map((acc) => {
                                                    const isSelected = acc.id === toAccountId;
                                                    const isSource = acc.id === fromAccountId;
                                                    return (
                                                        <TouchableOpacity
                                                            key={acc.id}
                                                            style={[
                                                                styles.accountOptionRow,
                                                                isSelected && styles.accountOptionRowActive,
                                                                isSource && { opacity: 0.4 },
                                                            ]}
                                                            onPress={() => {
                                                                setToAccountId(acc.id);
                                                                if (acc.linkedWalletId) setTargetWalletId(acc.linkedWalletId);
                                                                setIsToPickerOpen(false);
                                                            }}
                                                            activeOpacity={0.7}
                                                        >
                                                            <WalletLogo providerId={acc.provider} size={22} />
                                                            <View style={{ flex: 1, marginLeft: 10 }}>
                                                                <Text style={[styles.accountOptionName, isSelected && { color: colors.champagne }]}>
                                                                    {acc.displayName}
                                                                </Text>
                                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                                                    <Text style={styles.accountOptionSub}>{acc.maskedIdentifier}</Text>
                                                                    <View style={[styles.ownershipBadge, acc.ownership === 'OWN' ? styles.ownershipBadgeOwn : styles.ownershipBadgeExt]}>
                                                                        <Text style={[styles.ownershipBadgeText, acc.ownership === 'OWN' ? styles.ownershipBadgeTextOwn : styles.ownershipBadgeTextExt]}>
                                                                            {acc.ownership === 'OWN' ? 'MY' : 'EXT'}
                                                                        </Text>
                                                                    </View>
                                                                </View>
                                                            </View>
                                                            {isSelected && <Check size={16} color={colors.champagne} />}
                                                        </TouchableOpacity>
                                                    );
                                                })}

                                                {/* Enter New Account Button */}
                                                <TouchableOpacity
                                                    style={styles.addNewAccountOption}
                                                    onPress={() => {
                                                        setIsEnteringNewAccount(true);
                                                        setIsToPickerOpen(false);
                                                    }}
                                                    activeOpacity={0.8}
                                                >
                                                    <View style={styles.addNewIcon}>
                                                        <Plus size={16} color={colors.champagne} />
                                                    </View>
                                                    <Text style={styles.addNewAccountText}>+ Enter New Account / Beneficiary</Text>
                                                </TouchableOpacity>
                                            </ScrollView>
                                        </View>
                                    )}
                                </>
                            )}
                        </View>

                        {/* Same Account Warning */}
                        {isSameAccount && (
                            <View style={styles.warningBox}>
                                <AlertTriangle size={16} color={colors.danger} />
                                <Text style={styles.warningText}>Source and destination cannot be the same account.</Text>
                            </View>
                        )}

                        {/* Transfer Fee Input */}
                        <View style={styles.feeGroup}>
                            <Text style={styles.label}>TRANSFER FEES (SERVICE CHARGE, VAT, RECOVERY)</Text>
                            <TextInput
                                style={styles.textInput}
                                value={feeAmount}
                                onChangeText={setFeeAmount}
                                placeholder="0.00"
                                placeholderTextColor={colors.textMuted}
                                keyboardType="decimal-pad"
                            />
                        </View>

                        {/* Financial Calculation Breakdown Card */}
                        {principalNum > 0 && (
                            <View style={styles.calculationCard}>
                                <View style={styles.calcHeader}>
                                    <ArrowLeftRight size={15} color={colors.champagne} />
                                    <Text style={styles.calcTitle}>TRANSFER CALCULATION BREAKDOWN</Text>
                                </View>
                                <View style={styles.calcRow}>
                                    <Text style={styles.calcLabel}>Principal Amount:</Text>
                                    <Text style={styles.calcValue}>{formatEtb(principalNum)}</Text>
                                </View>
                                {transferFeeNum > 0 && (
                                    <View style={styles.calcRow}>
                                        <Text style={styles.calcLabel}>Transfer Fees:</Text>
                                        <Text style={[styles.calcValue, { color: colors.danger }]}>{formatEtb(transferFeeNum)}</Text>
                                    </View>
                                )}
                                <View style={styles.calcDivider} />
                                <View style={styles.calcRow}>
                                    <Text style={styles.calcHighlightLabel}>Total Source Debit:</Text>
                                    <Text style={[styles.calcHighlightValue, { color: colors.danger }]}>
                                        -{formatEtb(totalDebitCalc)}
                                    </Text>
                                </View>
                                <View style={styles.calcRow}>
                                    <Text style={styles.calcHighlightLabel}>Destination Credit:</Text>
                                    <Text style={[styles.calcHighlightValue, { color: colors.success }]}>
                                        +{formatEtb(principalNum)}
                                    </Text>
                                </View>
                                <View style={styles.calcNote}>
                                    <ShieldCheck size={13} color={colors.champagne} />
                                    <Text style={styles.calcNoteText}>
                                        Internal transfer is not counted as earned income or personal spending. Transfer fees are tracked as financial expenses.
                                    </Text>
                                </View>
                            </View>
                        )}
                    </View>
                ) : (
                    <>
                        {/* CATEGORY PICKER */}
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

                        {/* EXPENSE SPLIT OPTION */}
                        {type === 'DEBIT' && (
                            <>
                                <TouchableOpacity
                                    style={styles.splitToggleRow}
                                    onPress={() => {
                                        const next = !isSplitExpense;
                                        setIsSplitExpense(next);
                                        if (next && !personalShare && parseFloat(amount) > 0) {
                                            const half = (parseFloat(amount) / 2).toFixed(2);
                                            setPersonalShare(half);
                                            setParticipants([{ name: '', amount: half }]);
                                        }
                                    }}
                                    activeOpacity={0.8}
                                >
                                    <View style={styles.splitToggleLabel}>
                                        <Users size={16} color={colors.champagne} />
                                        <Text style={styles.splitToggleText}>
                                            Split this expense with others?
                                        </Text>
                                    </View>
                                    <View
                                        style={[
                                            styles.checkboxBox,
                                            isSplitExpense && styles.checkboxBoxActive,
                                        ]}
                                    >
                                        {isSplitExpense && <Check size={14} color="#000" />}
                                    </View>
                                </TouchableOpacity>

                                {isSplitExpense && (
                                    <View style={styles.splitBox}>
                                        <View style={styles.feeGroup}>
                                            <Text style={styles.label}>MY PERSONAL SHARE (ETB)</Text>
                                            <TextInput
                                                style={styles.textInput}
                                                value={personalShare}
                                                onChangeText={setPersonalShare}
                                                placeholder="0.00"
                                                placeholderTextColor={colors.textMuted}
                                                keyboardType="decimal-pad"
                                            />
                                        </View>

                                        <Text style={styles.label}>PARTICIPANTS & AMOUNTS OWED</Text>
                                        {participants.map((p, idx) => (
                                            <View key={idx} style={styles.participantRow}>
                                                <TextInput
                                                    style={styles.participantNameInput}
                                                    placeholder="Participant Name"
                                                    placeholderTextColor={colors.textMuted}
                                                    value={p.name}
                                                    onChangeText={(val) => {
                                                        const copy = [...participants];
                                                        copy[idx].name = val;
                                                        setParticipants(copy);
                                                    }}
                                                />
                                                <TextInput
                                                    style={styles.participantAmountInput}
                                                    placeholder="ETB"
                                                    placeholderTextColor={colors.textMuted}
                                                    value={p.amount}
                                                    keyboardType="decimal-pad"
                                                    onChangeText={(val) => {
                                                        const copy = [...participants];
                                                        copy[idx].amount = val;
                                                        setParticipants(copy);
                                                    }}
                                                />
                                                {participants.length > 1 && (
                                                    <TouchableOpacity
                                                        onPress={() =>
                                                            setParticipants(
                                                                participants.filter((_, i) => i !== idx)
                                                            )
                                                        }
                                                        style={{ padding: 4 }}
                                                    >
                                                        <Trash2 size={16} color={colors.danger} />
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        ))}

                                        <TouchableOpacity
                                            style={styles.addParticipantBtn}
                                            onPress={() =>
                                                setParticipants([
                                                    ...participants,
                                                    { name: '', amount: '' },
                                                ])
                                            }
                                            activeOpacity={0.7}
                                        >
                                            <Text style={styles.addParticipantBtnText}>
                                                + Add Another Participant
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </>
                        )}

                        {/* INCOME REIMBURSEMENT OPTION */}
                        {type === 'CREDIT' && pendingSharedExpenses.length > 0 && (
                            <>
                                <TouchableOpacity
                                    style={styles.splitToggleRow}
                                    onPress={() => setIsReimbursement(!isReimbursement)}
                                    activeOpacity={0.8}
                                >
                                    <View style={styles.splitToggleLabel}>
                                        <Users size={16} color={colors.champagne} />
                                        <Text style={styles.splitToggleText}>
                                            Reimbursement for a shared bill?
                                        </Text>
                                    </View>
                                    <View
                                        style={[
                                            styles.checkboxBox,
                                            isReimbursement && styles.checkboxBoxActive,
                                        ]}
                                    >
                                        {isReimbursement && <Check size={14} color="#000" />}
                                    </View>
                                </TouchableOpacity>

                                {isReimbursement && (
                                    <View style={styles.splitBox}>
                                        <Text style={styles.label}>SELECT SHARED EXPENSE</Text>
                                        {pendingSharedExpenses.map((se) => (
                                            <View key={se.id} style={{ marginBottom: 6 }}>
                                                <TouchableOpacity
                                                    style={[
                                                        styles.sharedExpenseOption,
                                                        selectedSharedExpenseId === se.id &&
                                                            styles.sharedExpenseOptionActive,
                                                    ]}
                                                    onPress={() => {
                                                        setSelectedSharedExpenseId(se.id);
                                                        setSelectedParticipantId('');
                                                    }}
                                                    activeOpacity={0.7}
                                                >
                                                    <Text style={styles.sharedExpenseOptionTitle}>
                                                        {se.description || 'Shared Expense'} • {se.totalAmount} ETB
                                                    </Text>
                                                    <Text style={styles.sharedExpenseOptionSubtitle}>
                                                        Pending receivable: {se.outstandingReceivable} ETB
                                                    </Text>
                                                </TouchableOpacity>
                                                {selectedSharedExpenseId === se.id && se.participants.length > 0 && (
                                                    <View style={{ marginTop: 6, paddingLeft: 4 }}>
                                                        <Text style={[styles.label, { fontSize: 10 }]}>PARTICIPANT REPAYING (OPTIONAL)</Text>
                                                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                                                            {se.participants.map((p) => {
                                                                const isSelected = selectedParticipantId === p.id;
                                                                const owes = Math.max(0, p.expectedAmount - p.paidAmount);
                                                                return (
                                                                    <TouchableOpacity
                                                                        key={p.id}
                                                                        style={{
                                                                            paddingHorizontal: 8,
                                                                            paddingVertical: 4,
                                                                            borderRadius: 6,
                                                                            borderWidth: 1,
                                                                            borderColor: isSelected ? colors.champagne : colors.border,
                                                                            backgroundColor: isSelected ? `${colors.champagne}20` : colors.surface,
                                                                        }}
                                                                        onPress={() => setSelectedParticipantId(isSelected ? '' : p.id)}
                                                                    >
                                                                        <Text
                                                                            style={{
                                                                                fontSize: 11,
                                                                                color: isSelected ? colors.champagne : colors.textPrimary,
                                                                                fontWeight: isSelected ? '700' : '400',
                                                                            }}
                                                                        >
                                                                            {p.name}: {owes > 0 ? `${owes} ETB` : 'Paid'}
                                                                        </Text>
                                                                    </TouchableOpacity>
                                                                );
                                                            })}
                                                        </View>
                                                    </View>
                                                )}
                                            </View>
                                        ))}
                                    </View>
                                )}
                            </>
                        )}
                    </>
                )}

                {/* NOTE */}
                <NoteInput
                    value={note}
                    onChangeText={setNote}
                    placeholder={
                        type === 'CREDIT'
                            ? 'e.g. Salary, Freelance, Bonus'
                            : type === 'TRANSFER'
                            ? 'e.g. Transfer CBE to Telebirr'
                            : 'e.g. Coffee at Tomoca'
                    }
                />

                {/* SUBMIT */}
                <PrimaryButton
                    label={
                        type === 'CREDIT'
                            ? 'Add Income'
                            : type === 'TRANSFER'
                            ? isSameAccount
                                ? 'Select Different Accounts'
                                : 'Complete Transfer'
                            : 'Add Expense'
                    }
                    onPress={handleSubmit}
                    disabled={isSameAccount}
                    color={accentColor}
                />
            </ScrollView>
        </ModalShell>
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
    // This is what keeps HomeScreen visible behind
    // the floating form.
    // Centers the floating form.

    // Very subtle inner glass border.

    // HEADER
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
    headerImportButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 16,
        backgroundColor: colors.surfaceAlt,
        borderWidth: 1,
        borderColor: colors.border,
    },
    headerImportButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.champagne,
        letterSpacing: 0.2,
    },
    feeGroup: {
        gap: 6,
    },
    textInput: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 14,
        color: colors.textPrimary,
        backgroundColor: colors.surfaceAlt,
    },
    splitToggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        paddingHorizontal: 4,
    },
    splitToggleLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    splitToggleText: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    checkboxBox: {
        width: 20,
        height: 20,
        borderRadius: 5,
        borderWidth: 1.5,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceAlt,
    },
    checkboxBoxActive: {
        backgroundColor: colors.champagne,
        borderColor: colors.champagne,
    },
    splitBox: {
        gap: 12,
        padding: 12,
        borderRadius: 14,
        backgroundColor: colors.surfaceAlt,
        borderWidth: 1,
        borderColor: colors.border,
    },
    participantRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    participantNameInput: {
        flex: 2,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 13,
        color: colors.textPrimary,
        backgroundColor: colors.surface,
    },
    participantAmountInput: {
        flex: 1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 13,
        color: colors.textPrimary,
        backgroundColor: colors.surface,
    },
    addParticipantBtn: {
        paddingVertical: 8,
        alignItems: 'center',
    },
    addParticipantBtnText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.champagne,
    },
    sharedExpenseOption: {
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        gap: 3,
    },
    sharedExpenseOptionActive: {
        borderColor: colors.champagne,
        backgroundColor: `${colors.champagne}15`,
    },
    sharedExpenseOptionTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    sharedExpenseOptionSubtitle: {
        fontSize: 11,
        color: colors.textSecondary,
    },
    selectorWrapper: {
        position: 'relative',
        zIndex: 1,
    },
    accountSelectorButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        backgroundColor: colors.surfaceAlt,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    accountSelectorLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    accountInfoCol: {
        marginLeft: 10,
        flex: 1,
    },
    accountNameText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    accountMaskedText: {
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 2,
    },
    accountDropdownList: {
        marginTop: 6,
        backgroundColor: colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 6,
        zIndex: 10,
    },
    accountOptionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        borderRadius: 8,
    },
    accountOptionRowActive: {
        backgroundColor: `${colors.champagne}15`,
    },
    accountOptionName: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    accountOptionSub: {
        fontSize: 11,
        color: colors.textSecondary,
    },
    ownershipBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    ownershipBadgeOwn: {
        backgroundColor: `${colors.champagne}20`,
    },
    ownershipBadgeExt: {
        backgroundColor: `${colors.textSecondary}20`,
    },
    ownershipBadgeText: {
        fontSize: 9,
        fontWeight: '700',
    },
    ownershipBadgeTextOwn: {
        color: colors.champagne,
    },
    ownershipBadgeTextExt: {
        color: colors.textSecondary,
    },
    addNewAccountOption: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        marginTop: 4,
    },
    addNewIcon: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: `${colors.champagne}20`,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    addNewAccountText: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.champagne,
    },
    newAccountCard: {
        padding: 12,
        backgroundColor: colors.surfaceAlt,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    newAccountHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    newAccountTitle: {
        fontSize: 11,
        fontWeight: '700',
        color: colors.champagne,
        letterSpacing: 0.5,
    },
    switchModeBtn: {
        paddingVertical: 4,
        paddingHorizontal: 8,
    },
    switchModeBtnText: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.champagne,
    },
    subLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: colors.textSecondary,
        letterSpacing: 0.5,
    },
    providerChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    providerChipActive: {
        borderColor: colors.champagne,
        backgroundColor: `${colors.champagne}15`,
    },
    providerChipText: {
        fontSize: 11,
        color: colors.textSecondary,
    },
    providerChipTextActive: {
        color: colors.champagne,
        fontWeight: '700',
    },
    ownershipRow: {
        flexDirection: 'row',
        gap: 8,
    },
    ownershipBtn: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 8,
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    ownershipBtnActive: {
        borderColor: colors.champagne,
        backgroundColor: `${colors.champagne}15`,
    },
    ownershipBtnText: {
        fontSize: 12,
        color: colors.textSecondary,
    },
    ownershipBtnTextActive: {
        color: colors.champagne,
        fontWeight: '600',
    },
    checkboxRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 4,
    },
    checkboxLabel: {
        fontSize: 11,
        color: colors.textSecondary,
        flex: 1,
    },
    warningBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 10,
        backgroundColor: `${colors.danger}15`,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.danger,
    },
    warningText: {
        fontSize: 12,
        color: colors.danger,
        fontWeight: '500',
        flex: 1,
    },
    calculationCard: {
        padding: 12,
        backgroundColor: colors.surfaceAlt,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.champagne + '40',
        gap: 6,
    },
    calcHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 4,
    },
    calcTitle: {
        fontSize: 11,
        fontWeight: '700',
        color: colors.champagne,
        letterSpacing: 0.5,
    },
    calcRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    calcLabel: {
        fontSize: 12,
        color: colors.textSecondary,
    },
    calcValue: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    calcDivider: {
        height: 1,
        backgroundColor: colors.border,
        marginVertical: 4,
    },
    calcHighlightLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: colors.textPrimary,
    },
    calcHighlightValue: {
        fontSize: 14,
        fontWeight: '800',
    },
    calcNote: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        marginTop: 6,
        paddingTop: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
    },
    calcNoteText: {
        fontSize: 10,
        color: colors.textMuted,
        flex: 1,
        lineHeight: 14,
    },
});