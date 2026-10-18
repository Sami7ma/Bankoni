// frontend/components/modals/AddWalletModal.tsx
// Creates a new wallet account with financial provider selection, legitimate opening balance,
// masked identifier, and default status.
// Aligned with the BanKoni floating glass card design system (AddBudgetModal / AddTransactionModal).

import React, { useState } from 'react';
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
    TouchableOpacity,
    View,
} from 'react-native';
import { Check } from 'lucide-react-native';

import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import CloseButton from '../common/buttons/CloseButton';
import AmountInput from '../common/inputs/AmountInput';
import PrimaryButton from '../common/buttons/PrimaryButton';
import WalletLogo from '../wallets/WalletLogo';
import { WALLET_PROVIDERS, getWalletProvider } from '../../constants/walletProviders';

interface AddWalletModalProps {
    visible: boolean;
    onClose: () => void;
}

export default function AddWalletModal({ visible, onClose }: AddWalletModalProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    const addWallet = useBanKoniStore((state) => state.addWallet);

    const [providerId, setProviderId] = useState<string>('cbe');
    const [name, setName] = useState('');
    const [openingBalance, setOpeningBalance] = useState('');
    const [accountNumberLast4, setAccountNumberLast4] = useState('');
    const [isDefault, setIsDefault] = useState(false);
    const [saving, setSaving] = useState(false);

    const resetForm = () => {
        setProviderId('cbe');
        setName('');
        setOpeningBalance('');
        setAccountNumberLast4('');
        setIsDefault(false);
        setSaving(false);
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleSelectProvider = (id: string) => {
        setProviderId(id);
        const prov = getWalletProvider(id);
        if (!name.trim() || WALLET_PROVIDERS.some((p) => p.name === name.trim())) {
            setName(prov.name);
        }
    };

    const handleSubmit = async () => {
        const cleanName = name.trim();
        if (!cleanName) {
            Alert.alert('Name Required', 'Please enter a name for this wallet.');
            return;
        }

        const parsedOpening = parseFloat(openingBalance.trim() || '0');
        if (isNaN(parsedOpening) || parsedOpening < 0) {
            Alert.alert('Invalid Balance', 'Please enter a valid numeric opening balance.');
            return;
        }

        setSaving(true);
        try {
            await addWallet({
                name: cleanName,
                icon: 'wallet',
                providerId,
                openingBalance: parsedOpening,
                currency: 'ETB',
                accountNumberLast4: accountNumberLast4.trim() ? accountNumberLast4.trim().slice(-4) : undefined,
                isDefault,
                isArchived: false,
            });
            handleClose();
        } catch (error) {
            Alert.alert('Error', error instanceof Error ? error.message : 'Could not add wallet.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={handleClose}
            statusBarTranslucent
        >
            <View style={styles.modalRoot}>
                {/* Backdrop */}
                <Pressable style={styles.backdrop} onPress={handleClose} />

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
                                <Text style={styles.headerEyebrow}>NEW ACCOUNT</Text>
                                <Text style={styles.headerTitle}>Add New Wallet</Text>
                            </View>
                            <CloseButton onPress={handleClose} />
                        </View>

                        {/* FORM */}
                        <ScrollView
                            style={styles.scroll}
                            contentContainerStyle={styles.form}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                        >
                            {/* Provider Picker */}
                            <Text style={styles.inputLabel}>Select Financial Provider</Text>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.providerPickerContainer}
                            >
                                {WALLET_PROVIDERS.map((prov) => {
                                    const isChosen = providerId === prov.id;
                                    return (
                                        <TouchableOpacity
                                            key={prov.id}
                                            style={[styles.providerOption, isChosen && styles.providerOptionSelected]}
                                            onPress={() => handleSelectProvider(prov.id)}
                                            activeOpacity={0.7}
                                        >
                                            <WalletLogo providerId={prov.id} size={40} />
                                            <Text
                                                style={[styles.providerOptionText, isChosen && styles.providerOptionTextSelected]}
                                                numberOfLines={1}
                                            >
                                                {prov.shortName}
                                            </Text>
                                            {isChosen && (
                                                <View style={styles.checkBadge}>
                                                    <Check size={10} color="#000000" />
                                                </View>
                                            )}
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>

                            {/* Wallet Name */}
                            <Text style={styles.inputLabel}>Wallet Name / Label</Text>
                            <TextInput
                                style={styles.textInput}
                                value={name}
                                onChangeText={setName}
                                placeholder="e.g. CBE Savings, Telebirr Personal"
                                placeholderTextColor={colors.textSecondary}
                            />

                            {/* Legitimate Opening Balance */}
                            <Text style={styles.inputLabel}>Opening Balance (ETB)</Text>
                            <AmountInput
                                variant="compact"
                                value={openingBalance}
                                onChangeText={setOpeningBalance}
                            />
                            <Text style={styles.helperText}>
                                Enter the true starting balance of this account. This value will be tracked distinctly from transactions.
                            </Text>

                            {/* Masked identifier / last 4 digits */}
                            <Text style={styles.inputLabel}>Last 4 Digits / Masked Identifier (Optional)</Text>
                            <TextInput
                                style={styles.textInput}
                                value={accountNumberLast4}
                                onChangeText={setAccountNumberLast4}
                                placeholder="e.g. 4821"
                                keyboardType="number-pad"
                                maxLength={4}
                                placeholderTextColor={colors.textSecondary}
                            />

                            {/* Default Toggle */}
                            <View style={styles.switchRow}>
                                <Text style={styles.switchLabel}>Set as Default Wallet</Text>
                                <Switch
                                    value={isDefault}
                                    onValueChange={setIsDefault}
                                    thumbColor={isDefault ? colors.champagne : colors.surfaceAlt}
                                    trackColor={{ false: colors.border, true: colors.subtleGold }}
                                />
                            </View>

                            <PrimaryButton
                                label={saving ? 'Creating...' : 'Create Wallet'}
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
            fontWeight: '700',
            color: colors.textPrimary,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            marginTop: 4,
            marginBottom: 2,
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
            color: colors.textSecondary,
            marginTop: 4,
            lineHeight: 18,
        },
        providerPickerContainer: {
            gap: 10,
            paddingVertical: 4,
        },
        providerOption: {
            alignItems: 'center',
            justifyContent: 'center',
            padding: 8,
            borderRadius: 14,
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
            width: 82,
            gap: 6,
        },
        providerOptionSelected: {
            borderColor: colors.champagne,
            backgroundColor: `${colors.champagne}18`,
        },
        providerOptionText: {
            fontSize: 11,
            color: colors.textSecondary,
            fontWeight: '500',
        },
        providerOptionTextSelected: {
            color: colors.champagne,
            fontWeight: '700',
        },
        checkBadge: {
            position: 'absolute',
            top: 4,
            right: 4,
            backgroundColor: colors.champagne,
            borderRadius: 8,
            width: 14,
            height: 14,
            alignItems: 'center',
            justifyContent: 'center',
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
