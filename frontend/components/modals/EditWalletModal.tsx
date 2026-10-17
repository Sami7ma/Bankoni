// frontend/components/modals/EditWalletModal.tsx
// Edits an existing wallet (name, opening balance, masked last 4 digits, default status).
// Modifying opening balance updates wallet balance correctly based on historical transactions.
// Aligned with the BanKoni floating glass card design system (EditTransactionModal / EditBudgetModal).

import React, { useEffect, useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from 'react-native';

import { Wallet } from '../../types/Wallet';
import useTheme from '../../hooks/useTheme';
import CloseButton from '../common/buttons/CloseButton';
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
                                <Text style={styles.headerEyebrow}>EDIT ACCOUNT</Text>
                                <Text style={styles.headerTitle}>Edit Wallet</Text>
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
                            {/* Wallet Name */}
                            <Text style={styles.inputLabel}>Wallet Name</Text>
                            <TextInput
                                style={styles.textInput}
                                value={name}
                                onChangeText={setName}
                                placeholder="Wallet Name"
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
                            <Text style={styles.inputLabel}>Last 4 Digits / Masked Identifier (Optional)</Text>
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
                                <Text style={styles.switchLabel}>Default Wallet</Text>
                                <Switch
                                    value={isDefault}
                                    onValueChange={setIsDefault}
                                    thumbColor={isDefault ? colors.champagne : colors.surfaceAlt}
                                    trackColor={{ false: colors.border, true: colors.subtleGold }}
                                />
                            </View>

                            <PrimaryButton
                                label={saving ? 'Saving...' : 'Save Changes'}
                                onPress={handleSubmit}
                                style={styles.submitButton}
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
