import { useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AtSign, Eye, EyeOff, Fingerprint, Lock, User as UserIcon } from 'lucide-react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { AuthStackParamList } from '../navigation/AppNavigator';
import useTheme from '../../hooks/useTheme';
import PrimaryButton from '../../components/common/buttons/PrimaryButton';
import useBanKoniStore from '../../store/useBanKoniStore';
import { validateNewPin } from '../../security/pinSecurity';

type Props = {
  navigation: StackNavigationProp<AuthStackParamList, 'Register'>;
};

export default function RegisterScreen({ navigation }: Props) {
  const colors = useTheme();
  const styles = createStyles(colors);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [enableBiometrics, setEnableBiometrics] = useState(false);
  const [loading, setLoading] = useState(false);
  const submitInFlight = useRef(false);

  const registeredUser = useBanKoniStore((state) => state.registeredUser);
  const isBiometricSupported = useBanKoniStore((state) => state.isBiometricSupported);
  const registerWithPin = useBanKoniStore((state) => state.registerWithPin);

  const handleRegister = async () => {
    if (submitInFlight.current) return;

    if (registeredUser) {
      Alert.alert(
        'Vault Already Exists',
        'BanKoni currently supports one local vault per installation. Unlock the existing vault instead of creating another profile.',
      );
      navigation.navigate('Login');
      return;
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim();

    if (cleanName.length < 2) {
      Alert.alert('Name Required', 'Enter a name with at least 2 characters.');
      return;
    }

    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      Alert.alert('Invalid Email', 'Enter a valid email address, or leave the field empty.');
      return;
    }

    if (!validateNewPin(pin)) {
      Alert.alert('Security PIN Error', 'Choose a PIN containing 6 to 12 numeric digits.');
      return;
    }

    if (pin !== confirmPin) {
      Alert.alert('PIN Mismatch', 'The PIN confirmation does not match.');
      return;
    }

    submitInFlight.current = true;
    setLoading(true);
    try {
      await registerWithPin(
        cleanName,
        pin,
        enableBiometrics && isBiometricSupported,
        cleanEmail || undefined,
      );
    } catch (error) {
      Alert.alert(
        'Registration Failed',
        error instanceof Error ? error.message : 'The local vault could not be created. Your existing data has not been intentionally deleted.',
      );
    } finally {
      submitInFlight.current = false;
      setLoading(false);
    }
  };

  const handleGoToLogin = () => navigation.navigate('Login');

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
          <Text style={styles.tagline}>Create Your Local Vault</Text>
          <Text style={styles.headerSubtitle}>Your records stay on this device.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name</Text>
            <View style={styles.inputRow}>
              <UserIcon size={18} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.textInput}
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={80}
                editable={!loading}
                returnKeyType="next"
                accessibilityLabel="Full name"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email (Optional)</Text>
            <View style={styles.inputRow}>
              <AtSign size={18} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.textInput}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                maxLength={254}
                editable={!loading}
                accessibilityLabel="Email address, optional"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Security PIN</Text>
            <View style={styles.inputRow}>
              <Lock size={18} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.textInput}
                value={pin}
                onChangeText={(text) => setPin(text.replace(/[^0-9]/g, '').slice(0, 12))}
                placeholder="6 to 12 digits"
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                secureTextEntry={!showPin}
                maxLength={12}
                editable={!loading}
                accessibilityLabel="Create a 6 to 12 digit PIN"
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPin((previous) => !previous)}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel={showPin ? 'Hide PIN' : 'Show PIN'}
              >
                {showPin
                  ? <EyeOff size={18} color={colors.textSecondary} />
                  : <Eye size={18} color={colors.textSecondary} />}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm Security PIN</Text>
            <View style={styles.inputRow}>
              <Lock size={18} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.textInput}
                value={confirmPin}
                onChangeText={(text) => setConfirmPin(text.replace(/[^0-9]/g, '').slice(0, 12))}
                placeholder="Re-enter your PIN"
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                secureTextEntry={!showPin}
                maxLength={12}
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={() => void handleRegister()}
                accessibilityLabel="Confirm security PIN"
              />
            </View>
          </View>

          {isBiometricSupported && (
            <View style={styles.switchRow}>
              <View style={styles.switchInfo}>
                <Fingerprint size={22} color={colors.champagne} />
                <View style={styles.switchCopy}>
                  <Text style={styles.switchTitle}>Biometric Unlock</Text>
                  <Text style={styles.switchSubtitle}>Use fingerprint or Face ID</Text>
                </View>
              </View>
              <Switch
                value={enableBiometrics}
                onValueChange={setEnableBiometrics}
                disabled={loading}
                trackColor={{ false: colors.border, true: colors.champagne }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Enable biometric unlock"
              />
            </View>
          )}

          <PrimaryButton
            label={loading ? 'Creating Vault...' : 'Create BanKoni Vault'}
            onPress={handleRegister}
            style={styles.submitButton}
            disabled={loading || Boolean(registeredUser)}
          />
        </View>

        <View style={styles.loginRow}>
          <Text style={styles.loginText}>Already have a vault? </Text>
          <TouchableOpacity onPress={handleGoToLogin} disabled={loading}>
            <Text style={styles.loginLink}>Unlock with PIN</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 38, paddingBottom: 32 },
  header: { marginBottom: 20, alignItems: 'center' },
  drawerLogo: {
    width: 110,
    height: 85,
    marginBottom: 8,
  },
  logo: { fontSize: 36, fontWeight: '700', color: colors.champagne, letterSpacing: 1.5 },
  tagline: { fontSize: 21, fontWeight: '700', color: colors.textPrimary, marginTop: 5 },
  headerSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 6, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  inputGroup: { marginBottom: 3 },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 7,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 8 },
  textInput: { flex: 1, color: colors.textPrimary, paddingVertical: 12, fontSize: 15 },
  eyeButton: { padding: 8 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 4,
  },
  switchInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  switchCopy: { marginLeft: 12 },
  switchTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  switchSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  submitButton: { marginTop: 10 },
  loginRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  loginText: { color: colors.textSecondary, fontSize: 14 },
  loginLink: { color: colors.champagne, fontSize: 14, fontWeight: '700' },
});
