// frontend/app/(app)/SettingsScreen.tsx
// Account, security, preferences, and backup controls for the local BanKoni vault.
// Follows the same screen structure as AnalyticsScreen and TransactionScreen.

import { useEffect, useState, type ReactNode } from 'react';
import {
    Alert,
    LayoutAnimation,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    UIManager,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
    Bell,
    BellRing,
    ChevronDown,
    ChevronUp,
    Database,
    Fingerprint,
    FolderInput,
    LockKeyhole,
    Mail,
    Moon,
    SlidersHorizontal,
    Sun,
    UserRound,
} from 'lucide-react-native';
import * as SecureStore from 'expo-secure-store';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import PrimaryButton from '../../components/common/buttons/PrimaryButton';
import { validateNewPin } from '../../security/pinSecurity';
import type { ExportDataPayload } from '../../types/User';

type SectionKey = 'profile' | 'security' | 'preferences' | 'data';

// Android requires this opt-in for LayoutAnimation on some React Native versions.
if (
    Platform.OS === 'android' &&
    UIManager.setLayoutAnimationEnabledExperimental
) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function SettingsScreen() {
    const colors = useTheme();
    const styles = createStyles(colors);

    const user = useBanKoniStore((state) => state.user);
    const updateProfile = useBanKoniStore((state) => state.updateProfile);
    const changePin = useBanKoniStore((state) => state.changePin);
    const enableBiometrics = useBanKoniStore((state) => state.enableBiometrics);
    const isBiometricSupported = useBanKoniStore(
        (state) => state.isBiometricSupported,
    );
    const theme = useBanKoniStore((state) => state.theme);
    const toggleTheme = useBanKoniStore((state) => state.toggleTheme);
    const exportDataToJSONFile = useBanKoniStore(
        (state) => state.exportDataToJSONFile,
    );
    const importDataFromJSON = useBanKoniStore(
        (state) => state.importDataFromJSON,
    );

    // Keep only one accordion section open at a time.
    const [expanded, setExpanded] = useState<SectionKey | null>('profile');

    const [name, setName] = useState(user?.name ?? '');
    const [email, setEmail] = useState(user?.email ?? '');
    const [savingProfile, setSavingProfile] = useState(false);

    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [changingPin, setChangingPin] = useState(false);
    const [changingBiometrics, setChangingBiometrics] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);

    // Budget alerts configuration state
    const [budgetAlertsEnabled, setBudgetAlertsEnabled] = useState(true);
    const [popupAlertsEnabled, setPopupAlertsEnabled] = useState(true);
    const [alertThreshold, setAlertThreshold] = useState<number>(0.8);

    // Refresh the editor if the authenticated profile changes.
    useEffect(() => {
        setName(user?.name ?? '');
        setEmail(user?.email ?? '');
    }, [user?.name, user?.email]);

    // Load budget alert preferences on mount
    useEffect(() => {
        (async () => {
            try {
                const alertsPref = await SecureStore.getItemAsync('bankoni_budget_alerts_enabled');
                if (alertsPref !== null) setBudgetAlertsEnabled(alertsPref === 'true');
                const popupPref = await SecureStore.getItemAsync('bankoni_popup_alerts_enabled');
                if (popupPref !== null) setPopupAlertsEnabled(popupPref === 'true');
                const thresholdPref = await SecureStore.getItemAsync('bankoni_alert_threshold');
                if (thresholdPref !== null) setAlertThreshold(parseFloat(thresholdPref) || 0.8);
            } catch {
                // Ignore storage error
            }
        })();
    }, []);

    const handleToggleBudgetAlerts = async (val: boolean) => {
        setBudgetAlertsEnabled(val);
        try {
            await SecureStore.setItemAsync('bankoni_budget_alerts_enabled', val ? 'true' : 'false');
        } catch {}
    };

    const handleTogglePopupAlerts = async (val: boolean) => {
        setPopupAlertsEnabled(val);
        try {
            await SecureStore.setItemAsync('bankoni_popup_alerts_enabled', val ? 'true' : 'false');
        } catch {}
    };

    const handleSelectThreshold = async (val: number) => {
        setAlertThreshold(val);
        try {
            await SecureStore.setItemAsync('bankoni_alert_threshold', val.toString());
        } catch {}
    };

    const toggleSection = (section: SectionKey) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((current) => (current === section ? null : section));
    };

    const saveProfile = async () => {
        if (!user) {
            Alert.alert('Vault locked', 'Unlock BanKoni before editing your profile.');
            return;
        }

        const cleanName = name.trim();
        const cleanEmail = email.trim();

        if (!cleanName) {
            Alert.alert('Name required', 'Enter your name before saving.');
            return;
        }

        if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            Alert.alert('Invalid email', 'Check the email address and try again.');
            return;
        }

        setSavingProfile(true);
        try {
            await updateProfile(cleanName, cleanEmail || undefined);
            Alert.alert('Profile updated', 'Your changes have been saved.');
        } catch (error) {
            Alert.alert(
                'Could not save profile',
                error instanceof Error ? error.message : 'Please try again.',
            );
        } finally {
            setSavingProfile(false);
        }
    };

    const submitPinChange = async () => {
        if (!currentPin.trim() || !validateNewPin(newPin)) {
            Alert.alert(
                'Check your PIN',
                'Enter your current PIN and choose a new PIN of 4–12 numeric digits.',
            );
            return;
        }

        if (newPin !== confirmPin) {
            Alert.alert('PIN mismatch', 'The new PIN entries do not match.');
            return;
        }

        setChangingPin(true);
        try {
            await changePin(currentPin, newPin);
            setCurrentPin('');
            setNewPin('');
            setConfirmPin('');
            Alert.alert('PIN changed', 'Your new PIN has been saved.');
        } catch (error) {
            Alert.alert(
                'Could not change PIN',
                error instanceof Error ? error.message : 'Please try again.',
            );
        } finally {
            setChangingPin(false);
        }
    };

    const handleBiometricsChange = async (enabled: boolean) => {
        if (changingBiometrics) return;

        setChangingBiometrics(true);
        try {
            await enableBiometrics(enabled);
        } catch (error) {
            Alert.alert(
                'Biometrics not changed',
                error instanceof Error ? error.message : 'Please try again.',
            );
        } finally {
            setChangingBiometrics(false);
        }
    };

    const exportBackup = async () => {
        if (exporting || importing) return;

        setExporting(true);
        try {
            const fileName = await exportDataToJSONFile();
            if (!fileName) {
                Alert.alert('Export failed', 'BanKoni could not create the backup.');
            } else {
                Alert.alert(
                    'Backup Prepared',
                    `${fileName}\n\nStored and shared safely. It contains your financial records and preferences (excluding your PIN).`,
                );
            }
        } catch (error) {
            Alert.alert(
                'Export failed',
                error instanceof Error ? error.message : 'Please try again.',
            );
        } finally {
            setExporting(false);
        }
    };

    const handleImportBackup = async () => {
        if (importing || exporting) return;

        try {
            const pickerResult = await DocumentPicker.getDocumentAsync({
                type: ['application/json', 'text/json', '*/*'],
                copyToCacheDirectory: true,
            });

            if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
                return;
            }

            const asset = pickerResult.assets[0];
            const fileUri = asset.uri;

            setImporting(true);

            const content = await FileSystem.readAsStringAsync(fileUri, {
                encoding: FileSystem.EncodingType.UTF8,
            });

            let payload: ExportDataPayload;
            try {
                payload = JSON.parse(content);
            } catch {
                Alert.alert(
                    'Invalid File',
                    'The selected file could not be parsed as JSON. Please ensure you selected a valid BanKoni backup file.',
                );
                return;
            }

            if (
                !payload ||
                typeof payload !== 'object' ||
                !Array.isArray(payload.wallets) ||
                !Array.isArray(payload.categories) ||
                !Array.isArray(payload.transactions)
            ) {
                Alert.alert(
                    'Invalid Backup Format',
                    'This file is missing required BanKoni financial records (wallets, categories, or transactions).',
                );
                return;
            }

            const txCount = payload.transactions.length;
            const walletCount = payload.wallets.length;
            const budgetCount = Array.isArray(payload.budgets) ? payload.budgets.length : 0;
            const backupDate = payload.exportedAt
                ? new Date(payload.exportedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                  })
                : 'Unknown date';
            const vaultOwner = payload.user?.name ? `\nVault Owner: ${payload.user.name}` : '';

            Alert.alert(
                'Restore Backup',
                `Found backup created on ${backupDate}.${vaultOwner}\n\nContents:\n• ${txCount} transaction${txCount !== 1 ? 's' : ''}\n• ${walletCount} wallet${walletCount !== 1 ? 's' : ''}\n• ${budgetCount} budget${budgetCount !== 1 ? 's' : ''}\n\nRestoring will replace current financial records with this backup. Your device PIN will NOT be changed.`,
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Restore Data',
                        style: 'destructive',
                        onPress: async () => {
                            try {
                                setImporting(true);
                                const summary = await importDataFromJSON(payload);
                                Alert.alert(
                                    'Restore Successful',
                                    `Restored ${summary.restoredTransactions} transactions, ${summary.restoredWallets} wallets, and ${summary.restoredBudgets} budgets. All financial data is updated.`,
                                );
                            } catch (err) {
                                Alert.alert(
                                    'Restore Failed',
                                    err instanceof Error ? err.message : 'Could not restore backup.',
                                );
                            } finally {
                                setImporting(false);
                            }
                        },
                    },
                ],
            );
        } catch (err) {
            Alert.alert(
                'Import Failed',
                err instanceof Error ? err.message : 'Could not select or read the backup file.',
            );
        } finally {
            setImporting(false);
        }
    };

    const renderSection = (
        key: SectionKey,
        title: string,
        subtitle: string,
        icon: ReactNode,
        content: ReactNode,
    ) => {
        const isOpen = expanded === key;

        return (
            <View style={styles.sectionCard} key={key}>
                <TouchableOpacity
                    style={styles.sectionHeader}
                    onPress={() => toggleSection(key)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`${title} settings`}
                    accessibilityState={{ expanded: isOpen }}
                >
                    <View style={styles.sectionIcon}>{icon}</View>
                    <View style={styles.sectionHeading}>
                        <Text style={styles.sectionTitle}>{title}</Text>
                        <Text style={styles.sectionSubtitle}>{subtitle}</Text>
                    </View>
                    {isOpen ? (
                        <ChevronUp size={20} color={colors.textSecondary} />
                    ) : (
                        <ChevronDown size={20} color={colors.textSecondary} />
                    )}
                </TouchableOpacity>

                {isOpen && <View style={styles.sectionContent}>{content}</View>}
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar style={colors.statusBar} />

            {/* Keep the title/header separate from the scrolling settings content. */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Settings</Text>
                <Text style={styles.headerSubtitle}>
                    Your profile, security, preferences, and financial data.
                </Text>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {renderSection(
                    'profile',
                    'Profile',
                    'Your name, email, and vault information',
                    <UserRound size={22} color={colors.champagne} />,
                    <>
                        <Text style={styles.fieldLabel}>Full name</Text>
                        <TextInput
                            style={styles.input}
                            value={name}
                            onChangeText={setName}
                            placeholder="Your name"
                            placeholderTextColor={colors.textSecondary}
                            autoCapitalize="words"
                            autoCorrect={false}
                            editable={!savingProfile}
                            returnKeyType="next"
                            accessibilityLabel="Full name"
                        />

                        <Text style={styles.fieldLabel}>Email address (optional)</Text>
                        <View style={styles.inputWithIcon}>
                            <Mail size={18} color={colors.textSecondary} />
                            <TextInput
                                style={styles.emailInput}
                                value={email}
                                onChangeText={setEmail}
                                placeholder="you@example.com"
                                placeholderTextColor={colors.textSecondary}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!savingProfile}
                                returnKeyType="done"
                                accessibilityLabel="Email address"
                            />
                        </View>

                        <PrimaryButton
                            label={savingProfile ? 'Saving...' : 'Save Profile'}
                            onPress={saveProfile}
                            disabled={savingProfile || !user}
                            style={styles.primaryAction}
                        />

                        <View style={styles.vaultInfo}>
                            <Text style={styles.fieldLabel}>Local vault</Text>
                            <Text style={styles.infoText}>
                                This profile is stored on this device.
                            </Text>
                            <Text style={styles.infoText}>
                                Created:{' '}
                                {user?.createdAt
                                    ? new Date(user.createdAt).toLocaleDateString()
                                    : 'Not available'}
                            </Text>
                            <Text style={styles.infoText}>
                                Vault ID: {user?.id ?? 'Not available'}
                            </Text>
                        </View>
                    </>,
                )}

                {renderSection(
                    'security',
                    'Security',
                    'PIN and biometric unlock',
                    <LockKeyhole size={22} color={colors.champagne} />,
                    <>
                        <Text style={styles.fieldLabel}>Current PIN</Text>
                        <TextInput
                            style={styles.input}
                            value={currentPin}
                            onChangeText={(value) =>
                                setCurrentPin(value.replace(/\D/g, '').slice(0, 12))
                            }
                            keyboardType="number-pad"
                            secureTextEntry
                            placeholder="Enter current PIN"
                            placeholderTextColor={colors.textSecondary}
                            editable={!changingPin}
                            accessibilityLabel="Current PIN"
                        />

                        <Text style={styles.fieldLabel}>New PIN</Text>
                        <TextInput
                            style={styles.input}
                            value={newPin}
                            onChangeText={(value) =>
                                setNewPin(value.replace(/\D/g, '').slice(0, 12))
                            }
                            keyboardType="number-pad"
                            secureTextEntry
                            placeholder="4–12 digits"
                            placeholderTextColor={colors.textSecondary}
                            editable={!changingPin}
                            accessibilityLabel="New PIN"
                        />

                        <Text style={styles.fieldLabel}>Confirm new PIN</Text>
                        <TextInput
                            style={styles.input}
                            value={confirmPin}
                            onChangeText={(value) =>
                                setConfirmPin(value.replace(/\D/g, '').slice(0, 12))
                            }
                            keyboardType="number-pad"
                            secureTextEntry
                            placeholder="Repeat new PIN"
                            placeholderTextColor={colors.textSecondary}
                            editable={!changingPin}
                            accessibilityLabel="Confirm new PIN"
                        />

                        <PrimaryButton
                            label={changingPin ? 'Updating...' : 'Change PIN'}
                            onPress={submitPinChange}
                            disabled={changingPin || !user}
                            style={styles.primaryAction}
                        />

                        <View style={styles.separator} />

                        {isBiometricSupported ? (
                            <View style={styles.preferenceRow}>
                                <Fingerprint size={21} color={colors.champagne} />
                                <View style={styles.preferenceText}>
                                    <Text style={styles.rowTitle}>Biometric unlock</Text>
                                    <Text style={styles.infoText}>
                                        Use the fingerprint or face authentication enrolled on this device.
                                    </Text>
                                </View>
                                <Switch
                                    value={Boolean(user?.isBiometricEnabled)}
                                    onValueChange={handleBiometricsChange}
                                    disabled={changingBiometrics || !user}
                                    trackColor={{
                                        false: colors.switchTrackOff,
                                        true: colors.champagne,
                                    }}
                                    ios_backgroundColor={colors.switchTrackOff}
                                    thumbColor="#FFFFFF"
                                    accessibilityLabel="Enable biometric unlock"
                                />
                            </View>
                        ) : (
                            <Text style={styles.infoText}>
                                Biometrics are not available or not enrolled on this device.
                            </Text>
                        )}

                        <Text style={styles.helperNote}>
                            Automatic background locking is not configured by this screen. It should only be offered once its timeout and app-resume behavior are implemented.
                        </Text>
                    </>,
                )}

                {renderSection(
                    'preferences',
                    'Preferences',
                    'Appearance and financial defaults',
                    <SlidersHorizontal size={22} color={colors.champagne} />,
                    <>
                        {/* Theme Toggle */}
                        <View style={styles.preferenceRow}>
                            {theme === 'dark' ? (
                                <Moon size={21} color={colors.champagne} />
                            ) : (
                                <Sun size={21} color={colors.champagne} />
                            )}
                            <View style={styles.preferenceText}>
                                <Text style={styles.rowTitle}>Dark theme</Text>
                                <Text style={styles.infoText}>
                                    {theme === 'dark' ? 'Dark mode active' : 'Light mode active'}
                                </Text>
                            </View>
                            <Switch
                                value={theme === 'dark'}
                                onValueChange={toggleTheme}
                                trackColor={{
                                    false: colors.switchTrackOff,
                                    true: colors.champagne,
                                }}
                                ios_backgroundColor={colors.switchTrackOff}
                                thumbColor="#FFFFFF"
                                accessibilityLabel="Enable dark theme"
                            />
                        </View>

                        <View style={styles.separator} />

                        {/* Budget Alerts Master Toggle */}
                        <View style={styles.preferenceRow}>
                            <Bell size={21} color={colors.champagne} />
                            <View style={styles.preferenceText}>
                                <Text style={styles.rowTitle}>Budget alerts</Text>
                                <Text style={styles.infoText}>
                                    Notify when category spending approaches budget limits.
                                </Text>
                            </View>
                            <Switch
                                value={budgetAlertsEnabled}
                                onValueChange={handleToggleBudgetAlerts}
                                trackColor={{
                                    false: colors.switchTrackOff,
                                    true: colors.champagne,
                                }}
                                ios_backgroundColor={colors.switchTrackOff}
                                thumbColor="#FFFFFF"
                                accessibilityLabel="Enable budget alerts"
                            />
                        </View>

                        {/* Popup Modal Alerts Toggle */}
                        <View style={styles.preferenceRow}>
                            <BellRing size={21} color={budgetAlertsEnabled ? colors.champagne : colors.textSecondary} />
                            <View style={styles.preferenceText}>
                                <Text style={[styles.rowTitle, !budgetAlertsEnabled && { color: colors.textSecondary }]}>
                                    In-app popup warnings
                                </Text>
                                <Text style={styles.infoText}>
                                    Show an instant popup modal when a transaction breaches a limit.
                                </Text>
                            </View>
                            <Switch
                                value={popupAlertsEnabled && budgetAlertsEnabled}
                                onValueChange={handleTogglePopupAlerts}
                                disabled={!budgetAlertsEnabled}
                                trackColor={{
                                    false: colors.switchTrackOff,
                                    true: colors.champagne,
                                }}
                                ios_backgroundColor={colors.switchTrackOff}
                                thumbColor="#FFFFFF"
                                accessibilityLabel="Enable in-app popup warnings"
                            />
                        </View>

                        {/* Alert Threshold Pill Selection */}
                        <View style={[styles.thresholdContainer, !budgetAlertsEnabled && { opacity: 0.5 }]}>
                            <Text style={styles.thresholdTitle}>Warning threshold</Text>
                            <Text style={styles.infoText}>
                                Trigger warnings when category spending reaches:
                            </Text>
                            <View style={styles.thresholdPillRow}>
                                {[
                                    { label: '80% of limit', val: 0.8 },
                                    { label: '90% of limit', val: 0.9 },
                                    { label: '100% of limit', val: 1.0 },
                                ].map((item) => {
                                    const isSelected = alertThreshold === item.val;
                                    return (
                                        <TouchableOpacity
                                            key={item.val}
                                            style={[
                                                styles.thresholdPill,
                                                isSelected && styles.thresholdPillSelected,
                                            ]}
                                            onPress={() => budgetAlertsEnabled && handleSelectThreshold(item.val)}
                                            disabled={!budgetAlertsEnabled}
                                            activeOpacity={0.7}
                                        >
                                            <Text
                                                style={[
                                                    styles.thresholdPillText,
                                                    isSelected && styles.thresholdPillTextSelected,
                                                ]}
                                            >
                                                {item.label}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>
                    </>,
                )}

                {renderSection(
                    'data',
                    'Data & Backups',
                    'Export and protect your financial records',
                    <Database size={22} color={colors.champagne} />,
                    <>
                        <Text style={styles.infoText}>
                            Export your local vault to a JSON file to transfer to another device or keep a safe backup. The export contains all your financial records and settings (excluding your PIN).
                        </Text>

                        <View style={styles.dataButtonsCol}>
                            <PrimaryButton
                                label={exporting ? 'Preparing backup...' : 'Export Backup'}
                                onPress={exportBackup}
                                disabled={exporting || importing}
                                style={styles.primaryAction}
                            />

                            <TouchableOpacity
                                style={[
                                    styles.importButton,
                                    (exporting || importing) && styles.disabledButton,
                                ]}
                                onPress={handleImportBackup}
                                disabled={exporting || importing}
                                activeOpacity={0.8}
                            >
                                <FolderInput size={18} color={colors.champagne} />
                                <Text style={styles.importButtonText}>
                                    {importing ? 'Selecting backup...' : 'Import Backup'}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.helperNote}>
                            Backups can be restored on this or another installation. Your device access PIN remains safe and will never be overwritten.
                        </Text>
                    </>,
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        safeArea: {
            flex: 1,
            backgroundColor: colors.background,
        },
        header: {
            paddingHorizontal: 18,
            paddingTop: 2,
            paddingBottom: 14,
        },
        headerTitle: {
            fontSize: 28,
            fontWeight: 'bold',
            color: colors.textPrimary,
        },
        headerSubtitle: {
            fontSize: 14,
            color: colors.textSecondary,
            marginTop: 4,
            lineHeight: 20,
        },
        scrollContent: {
            paddingHorizontal: 14,
            paddingBottom: 28,
            gap: 12,
        },
        sectionCard: {
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
        },
        sectionHeader: {
            minHeight: 76,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            paddingVertical: 12,
            gap: 12,
        },
        sectionIcon: {
            width: 42,
            height: 42,
            borderRadius: 13,
            backgroundColor: colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
        },
        sectionHeading: {
            flex: 1,
            gap: 4,
        },
        sectionTitle: {
            fontSize: 15,
            fontWeight: '700',
            color: colors.textPrimary,
        },
        sectionSubtitle: {
            fontSize: 12,
            lineHeight: 17,
            color: colors.textSecondary,
        },
        sectionContent: {
            borderTopWidth: 1,
            borderTopColor: colors.border,
            padding: 16,
            gap: 10,
        },
        fieldLabel: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.textSecondary,
            marginTop: 4,
        },
        input: {
            minHeight: 48,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceAlt,
            borderRadius: 12,
            paddingHorizontal: 13,
            color: colors.textPrimary,
            fontSize: 15,
        },
        inputWithIcon: {
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceAlt,
            borderRadius: 12,
            paddingHorizontal: 13,
        },
        emailInput: {
            flex: 1,
            minHeight: 46,
            color: colors.textPrimary,
            fontSize: 15,
        },
        primaryAction: {
            marginTop: 6,
        },
        vaultInfo: {
            borderTopWidth: 1,
            borderTopColor: colors.border,
            marginTop: 9,
            paddingTop: 12,
            gap: 5,
        },
        infoText: {
            fontSize: 12,
            lineHeight: 18,
            color: colors.textSecondary,
        },
        helperNote: {
            fontSize: 11,
            lineHeight: 17,
            color: colors.textSecondary,
            marginTop: 4,
        },
        preferenceRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: 54,
        },
        preferenceText: {
            flex: 1,
            gap: 3,
        },
        rowTitle: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        separator: {
            height: 1,
            backgroundColor: colors.border,
            marginVertical: 5,
        },
        thresholdContainer: {
            gap: 6,
            marginTop: 8,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: colors.border,
        },
        thresholdTitle: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        thresholdPillRow: {
            flexDirection: 'row',
            gap: 8,
            marginTop: 6,
        },
        thresholdPill: {
            flex: 1,
            paddingVertical: 10,
            paddingHorizontal: 8,
            borderRadius: 12,
            backgroundColor: colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 0,
        },
        thresholdPillSelected: {
            backgroundColor: `${colors.champagne}18`,
            borderWidth: 1,
            borderColor: colors.champagne,
        },
        thresholdPillText: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.textSecondary,
        },
        thresholdPillTextSelected: {
            color: colors.champagne,
            fontWeight: '700',
        },
        dataButtonsCol: {
            gap: 10,
            marginTop: 10,
        },
        importButton: {
            minHeight: 48,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: colors.champagne,
            backgroundColor: `${colors.champagne}10`,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            paddingHorizontal: 16,
        },
        importButtonText: {
            fontSize: 15,
            fontWeight: '700',
            color: colors.champagne,
            letterSpacing: 0.3,
        },
        disabledButton: {
            opacity: 0.5,
        },
    });
