import { useEffect } from 'react';
import { AppState } from 'react-native';
import { getSmsTransactionCountDB } from './db/database';
import { nativeSms } from './sms/automatic/native';
import { drainSmsQueue } from './sms/automatic/processor';
import useBanKoniStore from './store/useBanKoniStore';
// App.tsx
// This is the ROOT of the entire app — the first thing that renders.
import AppNavigator from './app/navigation/AppNavigator';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function App() {
  const user = useBanKoniStore(state => state.user);
  useEffect(() => {
    let refreshing = false;
    let lastCount: number | undefined;
    const refresh = async (wake = true) => {
      if (refreshing || !user || AppState.currentState !== 'active') return;
      refreshing = true;
      try {
        if (wake || lastCount === undefined) await nativeSms?.recover();
        await drainSmsQueue();
        const count = await getSmsTransactionCountDB();
        if (useBanKoniStore.getState().user?.id === user.id && count !== lastCount) {
          await useBanKoniStore.getState().loadAllData();
          lastCount = count;
        }
      } catch { /* Queue is durable; settings expose retry. Auth initialization still fails closed. */ }
      finally { refreshing = false; }
    };
    if (user) void refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    // Refresh visible balances after native/headless imports without requiring an app restart.
    const timer = setInterval(() => void refresh(false), 5000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [user?.id]);
  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}
