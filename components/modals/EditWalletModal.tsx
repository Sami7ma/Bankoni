// frontend/components/modals/EditWalletModal.tsx
// Edits an existing wallet (name, opening balance, masked last 4 digits, default status).
// Modifying opening balance updates wallet balance correctly based on historical transactions.
// Aligned with the BanKoni floating glass card design system (EditTransactionModal / EditBudgetModal).

import { useEffect, useState } from 'react';
import {
    Alert,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from 'react-native';

import { Wallet } from '../../types/Wallet';
import useTheme from '../../hooks/useTheme';
import ModalShell from '../common/overlays/ModalShell';
import ModalHeader from '../common/overlays/ModalHeader';
import AmountInput from '../common/inputs/AmountInput';
import PrimaryButton from '../common/buttons/PrimaryButton';

interface EditWalletModalProps {
    visible: boolean;
    wallet: Wallet | null;
    onClose: () => void;
    onSave: (id: string, name: string, opening: string, last4: string, isDef: boolean) => Promise<void> | void;
}

export default function EditWalletModal({
    visible,
    wallet,
    onClose,
    onSave,
}: EditWalletModalProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    const [name, setName] = useState('');
    const [openingBalance, setOpeningBalance] = useState('');
    const [accountNumberLast4, setAccountNumberLast4] = useState('');
    const [isDefault, setIsDefault] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (wallet && visible) {
            setName(wallet.name);
            setOpeningBalance(wallet.openingBalance.toString());
            setAccountNumberLast4(wallet.accountNumberLast4 ?? '');
            setIsDefault(wallet.isDefault);
            setSaving(false);
        }
    }, [wallet, visible]);

    if (!wallet) return null;

    const handleSubmit = async () => {
        const cleanName = name.trim();
        if (!cleanName) {
            Alert.alert('Name Required', 'Wallet name cannot be empty.');
            return;
        }

        const parsedOpening = parseFloat(openingBalance.trim() || '0');
        if (isNaN(parsedOpening) || parsedOpening < 0) {
            Alert.alert('Invalid Balance', 'Please enter a valid numeric opening balance.');
            return;
        }

        setSaving(true);
        try {
            await onSave(
                wallet.id,
                cleanName,
                openingBalance.trim() || '0',
                accountNumberLast4.trim(),
                isDefault,
            );
            onClose();
        } catch (error) {
            Alert.alert('Update Failed', error instanceof Error ? error.message : 'Could not update wallet.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell visible={visible} onRequestClose={onClose}>
            <ModalHeader eyebrow="EDIT ACCOUNT" title="Edit Wallet" onClose={onClose} />

            {/* FORM */}
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.form}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {/* Wallet Name */}
                <Text style={styles.inputLabel}>Account / Wallet Name</Text>
                <TextInput
                    style={styles.textInput}
                    value={name}
                    onChangeText={setName}
                    placeholder="Account Name"
                    placeholderTextColor={colors.textMuted}
                />

                {/* Opening Balance */}
                <Text style={styles.inputLabel}>Opening Balance ({wallet.currency})</Text>
                <AmountInput
                    variant="compact"
                    currency={wallet.currency}
                    value={openingBalance}
                    onChangeText={setOpeningBalance}
                />
                <Text style={styles.helperText}>
                    Modifying the opening balance automatically recalculates the current balance while preserving all recorded transactions.
                </Text>

                {/* Last 4 Digits */}
                <Text style={styles.inputLabel}>Account Number (Last 4 Digits - Optional)</Text>
                <TextInput
                    style={styles.textInput}
                    value={accountNumberLast4}
                    onChangeText={setAccountNumberLast4}
                    placeholder="e.g. 4821"
                    keyboardType="number-pad"
                    maxLength={4}
                    placeholderTextColor={colors.textMuted}
                />

                {/* Default Toggle */}
                <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Default Account / Wallet</Text>
                    <Switch
                        value={isDefault}
                        onValueChange={setIsDefault}
                        thumbColor="#FFFFFF"
                        trackColor={{ false: colors.switchTrackOff, true: colors.champagne }}
                        ios_backgroundColor={colors.switchTrackOff}
                    />
                </View>

                <PrimaryButton
                    label={saving ? 'Saving...' : 'Save Changes'}
                    onPress={handleSubmit}
                    style={styles.submitButton}
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
            gap: 14,
        },
        inputLabel: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.textSecondary,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            marginTop: 4,
        },
        textInput: {
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 14,
            color: colors.textPrimary,
            fontSize: 15,
        },
        helperText: {
            fontSize: 12,
            color: colors.textMuted,
            marginTop: -6,
            lineHeight: 17,
        },
        switchRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 6,
        },
        switchLabel: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        submitButton: {
            marginTop: 8,
            marginBottom: 12,
        },
    });
