// Chooses between first-run onboarding, the single local vault's lock screen,
// and the main application. Database initialization failures fail closed.

import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ArrowLeftRight, BarChart, Home, PiggyBank, Settings as SettingsIcon, Wallet as WalletIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';

import OnboardingScreen from '../(auth)/OnboardingScreen';
import LoginScreen from '../(auth)/LoginScreen';
import RegisterScreen from '../(auth)/RegisterScreen';
import HomeScreen from '../(app)/HomeScreen';
import LedgerScreen from '../(app)/LedgerScreen';
import BudgetsScreen from '../(app)/BudgetsScreen';
import AnalyticsScreen from '../(app)/AnalyticsScreen';
import SettingsScreen from '../(app)/SettingsScreen';
import PrimaryButton from '../../components/common/buttons/PrimaryButton';

export type AuthStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  Register: undefined;
};

export type AppTabParamList = {
  Home: undefined;
  Ledger: { initialTab?: 'wallets' | 'transactions' } | undefined;
  Budgets: undefined;
  Analytics: undefined;
  Settings: undefined;
};

const AuthStack = createStackNavigator<AuthStackParamList>();
const AppTabs = createBottomTabNavigator<AppTabParamList>();

function StartupErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const colors = useTheme();
  const styles = createStartupStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>BanKoni</Text>
      <Text style={styles.title}>Your vault could not be opened</Text>
      <Text style={styles.message}>{message}</Text>
      <Text style={styles.note}>
        BanKoni has stopped here to avoid treating an unreadable vault as a new installation. Your stored records have not been intentionally deleted.
      </Text>
      <PrimaryButton label="Try Again" onPress={onRetry} style={styles.retryButton} />
    </View>
  );
}

function AuthNavigator() {
  const colors = useTheme();
  const registeredUser = useBanKoniStore((state) => state.registeredUser);

  return (
    <AuthStack.Navigator
      initialRouteName={registeredUser ? 'Login' : 'Onboarding'}
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: colors.background },
      }}
    >
      <AuthStack.Screen name="Onboarding" component={OnboardingScreen} />
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

function AppTabNavigator() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <AppTabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === 'ios'
            ? (insets.bottom > 0 ? 50 + insets.bottom : 60)
            : 60 + insets.bottom,
          paddingBottom: Platform.OS === 'ios' ? Math.max(8, insets.bottom > 0 ? insets.bottom / 2 : 8) : 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.champagne,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        tabBarIcon: ({ color }) => {
          if (route.name === 'Home') return <Home size={22} color={color} />;
          if (route.name === 'Ledger') return <WalletIcon size={22} color={color} />;
          if (route.name === 'Budgets') return <PiggyBank size={22} color={color} />;
          if (route.name === 'Analytics') return <BarChart size={22} color={color} />;
          if (route.name === 'Settings') return <SettingsIcon size={22} color={color} />;
          return null;
        },
        animation: 'none',
      })}
    >
      <AppTabs.Screen name="Home" component={HomeScreen} />
      <AppTabs.Screen name="Ledger" component={LedgerScreen} options={{ tabBarLabel: 'Ledger' }} />
      <AppTabs.Screen name="Budgets" component={BudgetsScreen} options={{ tabBarLabel: 'Budgets' }} />
      <AppTabs.Screen name="Analytics" component={AnalyticsScreen} options={{ tabBarLabel: 'Analytics' }} />
      <AppTabs.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
    </AppTabs.Navigator>
  );
}

export default function AppNavigator() {
  const user = useBanKoniStore((state) => state.user);
  const isLoadingAuth = useBanKoniStore((state) => state.isLoadingAuth);
  const authError = useBanKoniStore((state) => state.authError);
  const checkAuth = useBanKoniStore((state) => state.checkAuth);
  const colors = useTheme();

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  if (isLoadingAuth) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.champagne} />
      </View>
    );
  }

  if (authError) {
    return <StartupErrorScreen message={authError} onRetry={() => void checkAuth()} />;
  }

  return (
    <NavigationContainer>
      {user ? <AppTabNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

const createStartupStyles = (colors: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 26,
    backgroundColor: colors.background,
  },
  brand: { color: colors.champagne, fontSize: 30, fontWeight: '700', textAlign: 'center', marginBottom: 24 },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.textPrimary, fontSize: 14, lineHeight: 21, marginTop: 16, textAlign: 'center' },
  note: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  retryButton: { marginTop: 24 },
});
