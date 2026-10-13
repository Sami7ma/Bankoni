// frontend/app/(app)/SettingsScreen.tsx
// Account, security, preferences, and backup controls for the local BanKoni vault.
// Follows the same screen structure as AnalyticsScreen and TransactionScreen.

import React, { useEffect, useState, type ReactNode } from 'react';
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
    ChevronDown,
    ChevronUp,
    Database,
    Fingerprint,
    LockKeyhole,
    Mail,
    Moon,
    SlidersHorizontal,
    Sun,
    UserRound,
} from 'lucide-react-native';

import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import PrimaryButton from '../../components/common/buttons/PrimaryButton';
import { validateNewPin } from '../../security/pinSecurity';

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

    // Refresh the editor if the authenticated profile changes.
    useEffect(() => {
        setName(user?.name ?? '');
        setEmail(user?.email ?? '');
    }, [user?.name, user?.email]);

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
                'Enter your current PIN and choose a new PIN of 6–12 numeric digits.',
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
        if (exporting) return;

        setExporting(true);
        try {
            const fileName = await exportDataToJSONFile();
            if (!fileName) {
                Alert.alert('Export failed', 'BanKoni could not create the backup.');
            } else {
                Alert.alert(
                    'Backup prepared',
                    `${fileName}\nStore it somewhere safe. It contains financial records.`,
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
                                        false: colors.border,
                                        true: colors.champagne,
                                    }}
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
                        <View style={styles.preferenceRow}>
                            {theme === 'dark' ? (
                                <Moon size={21} color={colors.champagne} />
                            ) : (
                                <Sun size={21} color={colors.champagne} />
                            )}
                            <View style={styles.preferenceText}>
                                <Text style={styles.rowTitle}>Dark theme</Text>
                                <Text style={styles.infoText}>
                                    Change BanKoni's appearance.
                                </Text>
                            </View>
                            <Switch
                                value={theme === 'dark'}
                                onValueChange={toggleTheme}
                                trackColor={{
                                    false: colors.border,
                                    true: colors.champagne,
                                }}
                                thumbColor="#FFFFFF"
                                accessibilityLabel="Enable dark theme"
                            />
                        </View>

                        <View style={styles.separator} />
                        <Text style={styles.rowTitle}>Currency</Text>
                        <Text style={styles.infoText}>
                            Currency is configured per wallet. Keeping each wallet's actual currency prevents incompatible balances from being added together.
                        </Text>

                        <View style={styles.separator} />
                        <Text style={styles.rowTitle}>Budget alerts</Text>
                        <Text style={styles.infoText}>
                            Alert thresholds are configured on individual budgets. Notification scheduling is not available from this screen yet.
                        </Text>
                    </>,
                )}

                {renderSection(
                    'data',
                    'Data & Backups',
                    'Export and protect your financial records',
                    <Database size={22} color={colors.champagne} />,
                    <>
                        <Text style={styles.infoText}>
                            Export your local vault to a JSON file. The export contains financial records, so share and store it carefully.
                        </Text>

                        <PrimaryButton
                            label={exporting ? 'Preparing backup...' : 'Export Backup'}
                            onPress={exportBackup}
                            disabled={exporting}
                            style={styles.primaryAction}
                        />

                        <Text style={styles.helperNote}>
                            Restore is intentionally not exposed until backup validation, preview, and safe database replacement are implemented.
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
    });
