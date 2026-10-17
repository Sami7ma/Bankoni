import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Eye, EyeOff, Fingerprint, Lock } from 'lucide-react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { AuthStackParamList } from '../navigation/AppNavigator';
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import PrimaryButton from '../../components/common/buttons/PrimaryButton';

type Props = {
  navigation: StackNavigationProp<AuthStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const colors = useTheme();
  const styles = createStyles(colors);

  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const pinInFlight = useRef(false);
  const biometricInFlight = useRef(false);
  const automaticPromptAttempted = useRef(false);

  const registeredUser = useBanKoniStore((state) => state.registeredUser);
  const isBiometricSupported = useBanKoniStore((state) => state.isBiometricSupported);
  const loginWithPin = useBanKoniStore((state) => state.loginWithPin);
  const loginWithBiometrics = useBanKoniStore((state) => state.loginWithBiometrics);

  const biometricsEnabled = Boolean(registeredUser?.isBiometricEnabled && isBiometricSupported);
  const displayName = registeredUser?.name?.trim() || 'Your Vault';

  const handlePinLogin = useCallback(async () => {
    if (pinInFlight.current || biometricInFlight.current) return;

    if (!/^\d{4,12}$/.test(pin)) {
      Alert.alert('Invalid PIN', 'Enter your 4 to 12 digit PIN.');
      return;
    }

    pinInFlight.current = true;
    setLoading(true);
    try {
      const success = await loginWithPin(pin);
      if (!success) {
        setPin('');
        Alert.alert('Incorrect PIN', 'The PIN entered is not correct. Please try again.');
      }
    } catch (error) {
      Alert.alert(
        'Unable to Unlock Vault',
        error instanceof Error ? error.message : 'The vault could not be opened. Please try again.',
      );
    } finally {
      pinInFlight.current = false;
      setLoading(false);
    }
  }, [loginWithPin, pin]);

  const handleBiometricUnlock = useCallback(async (automatic = false) => {
    if (
      !biometricsEnabled ||
      pinInFlight.current ||
      biometricInFlight.current
    ) return;

    biometricInFlight.current = true;
    setBiometricLoading(true);
    try {
      const result = await loginWithBiometrics();
      if (result.status === 'failed' && !automatic) {
        Alert.alert('Biometric Authentication Failed', result.message || 'Please unlock with your PIN.');
      } else if (result.status === 'unavailable' && !automatic) {
        Alert.alert('Biometrics Unavailable', 'Please unlock with your PIN.');
      } else if (result.status === 'error') {
        Alert.alert('Unable to Load Vault', result.message || 'The vault data could not be loaded.');
      }
      // Cancellation is a normal fallback path. Keep the PIN input available.
    } catch (error) {
      if (!automatic) {
        Alert.alert(
          'Biometric Error',
          error instanceof Error ? error.message : 'Biometric authentication could not be completed.',
        );
      }
    } finally {
      biometricInFlight.current = false;
      setBiometricLoading(false);
    }
  }, [biometricsEnabled, loginWithBiometrics]);

  useEffect(() => {
    if (!biometricsEnabled || automaticPromptAttempted.current) return;
    automaticPromptAttempted.current = true;
    void handleBiometricUnlock(true);
  }, [biometricsEnabled, handleBiometricUnlock]);

  const handleGoToRegister = useCallback(() => {
    navigation.navigate('Register');
  }, [navigation]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style={colors.statusBar} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Image
            source={require('../../assets/BankoniDrawerNObaground.png')}
            style={styles.drawerLogo}
            resizeMode="contain"
          />
          <Text style={styles.logo}>BanKoni</Text>
          <Text style={styles.tagline}>Welcome Back</Text>
          <Text style={styles.userBadge}>{displayName}</Text>
          <Text style={styles.subtitle}>Enter your PIN to access your vault.</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Security PIN</Text>
          <View style={styles.inputRow}>
            <Lock size={18} color={colors.textSecondary} style={styles.lockIcon} />
            <TextInput
              style={styles.textInput}
              value={pin}
              onChangeText={(text) => setPin(text.replace(/[^0-9]/g, '').slice(0, 12))}
              placeholder="Enter your PIN"
              placeholderTextColor={colors.textSecondary}
              keyboardType="number-pad"
              secureTextEntry={!showPin}
              autoFocus={!biometricsEnabled}
              autoComplete="off"
              textContentType="none"
              maxLength={12}
              editable={!loading && !biometricLoading}
              returnKeyType="done"
              onSubmitEditing={() => void handlePinLogin()}
              accessibilityLabel="Security PIN"
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPin((previous) => !previous)}
              disabled={loading || biometricLoading}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={showPin ? 'Hide PIN' : 'Show PIN'}
            >
              {showPin
                ? <EyeOff size={18} color={colors.textSecondary} />
                : <Eye size={18} color={colors.textSecondary} />}
            </TouchableOpacity>
          </View>
        </View>

        <PrimaryButton
          label={loading ? 'Verifying...' : 'Unlock Vault'}
          onPress={handlePinLogin}
          disabled={loading || biometricLoading || pin.length < 4}
          style={styles.pinButton}
        />

        {biometricsEnabled && (
          <TouchableOpacity
            style={[styles.biometricButton, { borderColor: colors.border }]}
            onPress={() => void handleBiometricUnlock(false)}
            disabled={loading || biometricLoading}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Unlock with biometrics"
          >
            <Fingerprint size={23} color={colors.champagne} />
            <Text style={styles.biometricButtonText}>
              {biometricLoading ? 'Authenticating...' : 'Use Biometrics'}
            </Text>
          </TouchableOpacity>
        )}

        {!registeredUser && (
          <View style={styles.registerRow}>
            <Text style={styles.registerText}>New to BanKoni? </Text>
            <TouchableOpacity onPress={handleGoToRegister} disabled={loading || biometricLoading}>
              <Text style={styles.registerLink}>Create a Vault</Text>
            </TouchableOpacity>
          </View>
        )}

        {registeredUser && (
          <Text style={styles.vaultNotice}>
            This device has one local vault. Unlock it to access your records.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 40,
  },
  header: { marginBottom: 32, alignItems: 'center' },
  drawerLogo: {
    width: 130,
    height: 100,
    marginBottom: 10,
  },
  logo: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.champagne,
    letterSpacing: 1.5,
  },
  tagline: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginTop: 8 },
  userBadge: { fontSize: 16, fontWeight: '600', color: colors.champagne, marginTop: 5 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 7, textAlign: 'center' },
  inputGroup: { marginBottom: 12 },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 8,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  lockIcon: { marginRight: 8 },
  textInput: { flex: 1, color: colors.textPrimary, paddingVertical: 14, fontSize: 16, letterSpacing: 3 },
  eyeButton: { padding: 8 },
  pinButton: { marginTop: 8 },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    marginTop: 12,
    gap: 10,
  },
  biometricButtonText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  registerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 28 },
  registerText: { color: colors.textSecondary, fontSize: 14 },
  registerLink: { color: colors.champagne, fontSize: 14, fontWeight: '700' },
  vaultNotice: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 28, lineHeight: 18 },
});
