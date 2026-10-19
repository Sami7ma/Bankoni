// frontend/store/useBanKoniStore.ts
// The central brain of BanKoni — 100% Local-First with SQLite, PIN & Biometrics


import { create } from 'zustand';
import { Appearance } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { hashPin, verifyPin, isCurrentPinHash, validateNewPin } from '../security/pinSecurity';
import type { Transaction } from '../types/Transaction';
import type { Category } from '../types/Category';
import type { Budget } from '../types/Budget';
import type { Wallet } from '../types/Wallet';
import type { User, ExportDataPayload } from '../types/User';
import {
    initDatabase,
    getActiveUserDB,
    saveUserDB,
    setBiometricEnabledDB,
    getTransactionsDB,
    insertTransactionDB,
    updateTransactionDB,
    deleteTransactionDB,
    getBudgetsDB,
    insertBudgetDB,
    updateBudgetDB,
    deleteBudgetDB,
    getCategoriesDB,
    insertCategoryDB,
    deleteCategoryDB,
    getWalletsDB,
    insertWalletDB,
    updateWalletDB,
    setDefaultWalletDB,
    archiveWalletDB,
    deleteWalletDB,
    exportDatabaseToJSON,
    importDatabaseFromJSON,
    type ImportSummary,
    updateUserPinHashDB,
    getPinAttemptStateDB,
    recordFailedPinAttemptDB,
    resetPinAttemptStateDB,
    updateUserProfileDB,
} from '../db/database';

export type BiometricLoginResult =
    | { status: 'success' }
    | { status: 'cancelled' }
    | { status: 'unavailable' }
    | { status: 'failed'; message?: string }
    | { status: 'error'; message: string };

interface BanKoniStore {
    user: User | null;
    registeredUser: User | null;
    isBiometricSupported: boolean;
    isLoadingAuth: boolean;
    authError: string | null;
    isLoadingData: boolean;
    dataError: string | null;
    transactions: Transaction[];
    categories: Category[];
    budgets: Budget[];
    wallets: Wallet[];
    theme: 'light' | 'dark';

    // Authentication and security
    checkAuth: () => Promise<void>;
    registerWithPin: (name: string, pin: string, enableBiometrics?: boolean, email?: string) => Promise<void>;
    loginWithPin: (pin: string) => Promise<boolean>;
    loginWithBiometrics: () => Promise<BiometricLoginResult>;
    enableBiometrics: (enabled: boolean) => Promise<void>;
    logOut: () => Promise<void>;
    setUser: (user: User | null) => void;

    // Backwards-compatible aliases
    login: (emailOrPin: string, pincode?: string) => Promise<void>;
    register: (name: string, pincode: string) => Promise<void>;

    // Data loading
    loadAllData: () => Promise<void>;
    fetchTransactions: () => Promise<void>;
    fetchBudgets: () => Promise<void>;
    fetchCategories: () => Promise<void>;
    fetchWallets: (includeArchived?: boolean) => Promise<void>;

    // Transaction CRUD
    addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt'> | Transaction) => Promise<void>;
    updateTransaction: (id: string, updated: Partial<Omit<Transaction, 'id' | 'createdAt'>>) => Promise<void>;
    deleteTransaction: (id: string) => Promise<void>;

    // Budget CRUD
    addBudget: (budget: Omit<Budget, 'id'> | Budget) => Promise<void>;
    updateBudget: (id: string, updated: Partial<Omit<Budget, 'id'>>) => Promise<void>;
    deleteBudget: (id: string) => Promise<void>;

    // Category and wallet CRUD
    addCategory: (category: Omit<Category, 'id'>) => Promise<Category>;
    deleteCategory: (id: string) => Promise<void>;
    addWallet: (wallet: Omit<Wallet, 'id' | 'createdAt' | 'balance'> & { balance?: number }) => Promise<void>;
    updateWallet: (id: string, updated: Partial<Omit<Wallet, 'id' | 'createdAt'>>) => Promise<void>;
    setDefaultWallet: (id: string) => Promise<void>;
    archiveWallet: (id: string, isArchived: boolean) => Promise<void>;
    deleteWallet: (id: string) => Promise<void>;

    // Export & Import
    exportDataToJSONFile: () => Promise<string | null>;
    getExportPayload: () => Promise<ExportDataPayload>;
    importDataFromJSON: (payload: ExportDataPayload) => Promise<ImportSummary>;

    // Derived values (ETB cleared activity only where applicable)
    totalIncome: () => number;
    totalExpenses: () => number;
    totalBalance: () => number;
    transactionByCategory: () => Record<string, number>;

    // settings
    updateProfile: (name: string, email?: string) => Promise<void>;

    changePin: (currentPin: string, newPin: string,) => Promise<void>;
    // Theme
    setTheme: (theme: 'light' | 'dark') => Promise<void>;
    toggleTheme: () => Promise<void>;
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function makeId(prefix: string): string {
    return `${prefix}_${Crypto.randomUUID()}`;
}

async function readAllFinancialData() {
    const [transactions, categories, budgets, wallets] = await Promise.all([
        getTransactionsDB(),
        getCategoriesDB(),
        getBudgetsDB(),
        getWalletsDB(),
    ]);
    return { transactions, categories, budgets, wallets };
}

async function readTransactionsAndWallets() {
    const [transactions, wallets] = await Promise.all([getTransactionsDB(), getWalletsDB()]);
    return { transactions, wallets };
}

function getEtbClearedTransactions(state: Pick<BanKoniStore, 'transactions' | 'wallets'>): Transaction[] {
    const etbWalletIds = new Set(
        state.wallets.filter((wallet) => wallet.currency === 'ETB').map((wallet) => wallet.id),
    );
    return state.transactions.filter(
        (transaction) => transaction.status === 'CLEARED' && etbWalletIds.has(transaction.walletId),
    );
}

const useBanKoniStore = create<BanKoniStore>((set, get) => ({
    user: null,
    registeredUser: null,
    isBiometricSupported: false,
    isLoadingAuth: true,
    authError: null,
    isLoadingData: false,
    dataError: null,
    transactions: [],
    categories: [],
    budgets: [],
    wallets: [],
    theme: (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light') as 'light' | 'dark',

    // Discover the vault and device capabilities. A single screen owns the actual
    // biometric prompt, preventing simultaneous prompts at startup and on Login.
    checkAuth: async () => {
        set({
            isLoadingAuth: true,
            authError: null,
            dataError: null,
            user: null,
            transactions: [],
            categories: [],
            budgets: [],
            wallets: [],
        });
        try {
            await initDatabase();
            const [hardwareResult, active, savedTheme] = await Promise.all([
                Promise.all([
                    LocalAuthentication.hasHardwareAsync(),
                    LocalAuthentication.isEnrolledAsync(),
                ]),
                getActiveUserDB(),
                SecureStore.getItemAsync('bankoni_theme').catch(() => null),
            ]);
            const [hasHardware, enrolled] = hardwareResult;

            if (savedTheme === 'light' || savedTheme === 'dark') {
                set({ theme: savedTheme });
            } else {
                const sysTheme = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
                set({ theme: sysTheme });
            }

            set({
                registeredUser: active?.user ?? null,
                isBiometricSupported: hasHardware && enrolled,
                transactions: [],
                categories: [],
                budgets: [],
                wallets: [],
            });
        } catch (error) {
            // Do not reinterpret a database read failure as a first-time installation.
            set({ authError: errorMessage(error, 'BanKoni could not open its local vault.') });
        } finally {
            set({ isLoadingAuth: false });
        }
    },

    registerWithPin: async (name, pin, enableBiometrics = false, email) => {
        const cleanName = name.trim();
        const cleanEmail = email?.trim() || undefined;
        if (cleanName.length < 2) throw new Error('Name must contain at least 2 characters.');
        if (!validateNewPin(pin)) throw new Error('PIN must contain 4 to 12 numeric digits.');
        if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            throw new Error('Enter a valid email address or leave it empty.');
        }
        if (get().registeredUser || get().user) {
            throw new Error('A local vault already exists. Unlock it instead of creating another profile.');
        }

        await initDatabase();
        const current = await getActiveUserDB();
        if (current) {
            set({ registeredUser: current.user });
            throw new Error('A local vault already exists. Unlock it instead of creating another profile.');
        }

        let biometricEnabled = false;
        if (enableBiometrics) {
            const [hasHardware, enrolled] = await Promise.all([
                LocalAuthentication.hasHardwareAsync(),
                LocalAuthentication.isEnrolledAsync(),
            ]);
            if (!hasHardware || !enrolled) {
                throw new Error('Biometrics are not available or not enrolled on this device.');
            }
            biometricEnabled = true;
        }

        const newUser: User = {
            id: makeId('usr'),
            name: cleanName,
            email: cleanEmail,
            isBiometricEnabled: biometricEnabled,
            createdAt: new Date().toISOString(),
        };
        const pinHash = await hashPin(pin);
        await saveUserDB(newUser, pinHash);

        // Keep the profile discoverable if loading the first data snapshot fails;
        // the user can return to the lock screen rather than creating a second vault.
        set({ registeredUser: newUser });
        await get().loadAllData();
        set({ user: newUser, registeredUser: newUser, authError: null, dataError: null });
    },

    loginWithPin: async (pin) => {
        const attemptState = await getPinAttemptStateDB();
        if (attemptState.lockoutUntilMs > Date.now()) {
            const seconds = Math.ceil((attemptState.lockoutUntilMs - Date.now()) / 1000);
            throw new Error(`Too many incorrect PIN attempts. Try again in ${seconds} seconds.`);
        }

        const active = await getActiveUserDB();
        if (!active) return false;

        const valid = await verifyPin(pin.trim(), active.pinHash);
        if (!valid) {
            const updatedAttempts = await recordFailedPinAttemptDB();
            if (updatedAttempts.lockoutUntilMs > Date.now()) {
                const seconds = Math.ceil((updatedAttempts.lockoutUntilMs - Date.now()) / 1000);
                throw new Error(`Too many incorrect PIN attempts. Try again in ${seconds} seconds.`);
            }
            return false;
        }
        await resetPinAttemptStateDB();

        // Upgrade both plaintext records and older scrypt parameter sets only after
        // the entered PIN has been verified successfully.
        if (!isCurrentPinHash(active.pinHash)) {
            const upgradedHash = await hashPin(pin.trim());
            await updateUserPinHashDB(active.user.id, upgradedHash);
        }

        await get().loadAllData();
        set({ user: active.user, registeredUser: active.user, authError: null, dataError: null });
        return true;
    },

    loginWithBiometrics: async (): Promise<BiometricLoginResult> => {
        try {
            const active = await getActiveUserDB();
            if (!active?.user.isBiometricEnabled) return { status: 'unavailable' };

            const [hasHardware, enrolled] = await Promise.all([
                LocalAuthentication.hasHardwareAsync(),
                LocalAuthentication.isEnrolledAsync(),
            ]);
            if (!hasHardware || !enrolled) return { status: 'unavailable' };

            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: `Unlock BanKoni for ${active.user.name}`,
                cancelLabel: 'Use PIN',
                fallbackLabel: 'Use PIN',
                disableDeviceFallback: true,
            });

            if (!result.success) {
                const cancellable = new Set([
                    'user_cancel', 'app_cancel', 'system_cancel', 'user_fallback', 'timeout',
                ]);
                if (cancellable.has(result.error)) return { status: 'cancelled' };
                return { status: 'failed', message: 'Biometric verification was not successful. Use your PIN instead.' };
            }

            await resetPinAttemptStateDB();
            try {
                await get().loadAllData();
            } catch (error) {
                return { status: 'error', message: errorMessage(error, 'The vault data could not be loaded.') };
            }
            set({ user: active.user, registeredUser: active.user, authError: null, dataError: null });
            return { status: 'success' };
        } catch (error) {
            return { status: 'error', message: errorMessage(error, 'Biometric authentication could not be completed.') };
        }
    },

    enableBiometrics: async (enabled) => {
        const user = get().user;
        if (!user) throw new Error('Unlock the vault before changing biometric settings.');

        if (enabled) {
            const [hasHardware, enrolled] = await Promise.all([
                LocalAuthentication.hasHardwareAsync(),
                LocalAuthentication.isEnrolledAsync(),
            ]);
            if (!hasHardware || !enrolled) throw new Error('Biometrics are not available on this device.');

            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: 'Confirm biometric unlock for BanKoni',
                cancelLabel: 'Cancel',
                disableDeviceFallback: true,
            });
            if (!result.success) throw new Error('Biometric verification was cancelled or failed.');
        }

        await setBiometricEnabledDB(user.id, enabled);
        const updatedUser = {
            ...user,
            isBiometricEnabled: enabled,
        };

        set({
            user: updatedUser,
            registeredUser: updatedUser,
        });
    },

    logOut: async () => {
        // Preserve SQLite records. Clear this session's copies from memory.
        set({
            user: null,
            transactions: [],
            categories: [],
            budgets: [],
            wallets: [],
            dataError: null,
            isLoadingData: false,
        });
    },

    // Compatibility setter: it may lock an existing session, but cannot create an
    // authenticated session from an arbitrary object. Authentication actions own that transition.
    setUser: (user) => {
        if (user === null) {
            void get().logOut();
            return;
        }
        if (get().user?.id === user.id) set({ user: { ...get().user!, ...user } });
    },

    login: async (emailOrPin, pincode) => {
        const pin = pincode ?? emailOrPin;
        const success = await get().loginWithPin(pin);
        if (!success) throw new Error('Incorrect PIN or no vault is registered.');
    },

    register: async (name, pincode) => {
        await get().registerWithPin(name, pincode, false);
    },

    loadAllData: async () => {
        set({ isLoadingData: true, dataError: null });
        try {
            const data = await readAllFinancialData();
            set({ ...data, dataError: null });
        } catch (error) {
            const message = errorMessage(error, 'Financial data could not be loaded.');
            set({ dataError: message });
            throw new Error(message);
        } finally {
            set({ isLoadingData: false });
        }
    },

    fetchTransactions: async () => set({ transactions: await getTransactionsDB() }),
    fetchBudgets: async () => set({ budgets: await getBudgetsDB() }),
    fetchCategories: async () => set({ categories: await getCategoriesDB() }),
    fetchWallets: async (includeArchived?: boolean) => set({ wallets: await getWalletsDB(includeArchived ?? true) }),

    addTransaction: async (tx) => {
        const fullTransaction: Transaction = {
            ...tx,
            id: 'id' in tx && tx.id ? tx.id : makeId('tx'),
            createdAt: 'createdAt' in tx && tx.createdAt ? tx.createdAt : new Date().toISOString(),
        };
        await insertTransactionDB(fullTransaction);
        const data = await readTransactionsAndWallets();
        set(data);
    },

    updateTransaction: async (id, updated) => {
        await updateTransactionDB(id, updated);
        const data = await readTransactionsAndWallets();
        set(data);
    },

    deleteTransaction: async (id) => {
        await deleteTransactionDB(id);
        const data = await readTransactionsAndWallets();
        set(data);
    },

    addBudget: async (budget) => {
        const fullBudget: Budget = {
            ...budget,
            id: 'id' in budget && budget.id ? budget.id : makeId('budget'),
        };
        await insertBudgetDB(fullBudget);
        set({ budgets: await getBudgetsDB() });
    },

    updateBudget: async (id, updated) => {
        await updateBudgetDB(id, updated);
        set({ budgets: await getBudgetsDB() });
    },

    deleteBudget: async (id) => {
        await deleteBudgetDB(id);
        set({ budgets: await getBudgetsDB() });
    },

    addCategory: async (category) => {
        const fullCategory: Category = { ...category, id: makeId('category') };
        await insertCategoryDB(fullCategory);
        set({ categories: await getCategoriesDB() });
        return fullCategory;
    },

    deleteCategory: async (id) => {
        await deleteCategoryDB(id);
        set({ categories: await getCategoriesDB() });
    },

    addWallet: async (wallet) => {
        const fullWallet: Wallet = {
            ...wallet,
            id: makeId('wallet'),
            providerId: wallet.providerId || 'custom',
            openingBalance: wallet.openingBalance ?? 0,
            balance: wallet.openingBalance ?? 0,
            isArchived: wallet.isArchived ?? false,
            createdAt: new Date().toISOString(),
        };
        await insertWalletDB(fullWallet);
        set({ wallets: await getWalletsDB() });
    },

    updateWallet: async (id, updated) => {
        await updateWalletDB(id, updated);
        const data = await readTransactionsAndWallets();
        set({ wallets: data.wallets });
    },

    setDefaultWallet: async (id) => {
        await setDefaultWalletDB(id);
        set({ wallets: await getWalletsDB() });
    },

    archiveWallet: async (id, isArchived) => {
        await archiveWalletDB(id, isArchived);
        set({ wallets: await getWalletsDB() });
    },

    updateProfile: async (name, email) => {
        const currentUser = get().user;

        if (!currentUser) {
            throw new Error('Unlock BanKoni before editing your profile.');
        }

        const cleanName = name.trim();
        const cleanEmail = email?.trim() || undefined;

        if (!cleanName) {
            throw new Error('Name is required.');
        }

        if (
            cleanEmail &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
        ) {
            throw new Error('Enter a valid email address.');
        }

        // Commit the change to SQLite before updating the UI.
        await updateUserProfileDB(
            currentUser.id,
            cleanName,
            cleanEmail,
        );

        const updatedUser = {
            ...currentUser,
            name: cleanName,
            email: cleanEmail,
        };

        // Keep the active and login-screen profile copies consistent.
        set({
            user: updatedUser,
            registeredUser: updatedUser,
        });
    },

    changePin: async (currentPin, newPin) => {
        if (!validateNewPin(newPin)) {
            throw new Error('The new PIN must contain 4–12 numeric digits.');
        }

        if (currentPin === newPin) {
            throw new Error('Choose a different PIN.');
        }

        const active = await getActiveUserDB();

        if (!active) {
            throw new Error('No local vault was found.');
        }

        const validCurrentPin = await verifyPin(
            currentPin,
            active.pinHash,
        );

        if (!validCurrentPin) {
            throw new Error('The current PIN is incorrect.');
        }

        const newHash = await hashPin(newPin);

        await updateUserPinHashDB(active.user.id, newHash);
    },

    deleteWallet: async (id) => {
        await deleteWalletDB(id);
        set({ wallets: await getWalletsDB() });
    },

    getExportPayload: async () => {
        const [themePref, budgetAlertsPref, popupAlertsPref, alertThresholdPref] = await Promise.all([
            SecureStore.getItemAsync('bankoni_theme'),
            SecureStore.getItemAsync('bankoni_budget_alerts_enabled'),
            SecureStore.getItemAsync('bankoni_popup_alerts_enabled'),
            SecureStore.getItemAsync('bankoni_alert_threshold'),
        ]);

        const settings = {
            theme: (themePref === 'light' || themePref === 'dark') ? themePref : get().theme,
            budgetAlertsEnabled: budgetAlertsPref !== null ? budgetAlertsPref === 'true' : true,
            popupAlertsEnabled: popupAlertsPref !== null ? popupAlertsPref === 'true' : true,
            alertThreshold: alertThresholdPref !== null ? parseFloat(alertThresholdPref) : 0.8,
        };

        return exportDatabaseToJSON(settings);
    },

    exportDataToJSONFile: async () => {
        try {
            const [themePref, budgetAlertsPref, popupAlertsPref, alertThresholdPref] = await Promise.all([
                SecureStore.getItemAsync('bankoni_theme'),
                SecureStore.getItemAsync('bankoni_budget_alerts_enabled'),
                SecureStore.getItemAsync('bankoni_popup_alerts_enabled'),
                SecureStore.getItemAsync('bankoni_alert_threshold'),
            ]);

            const settings = {
                theme: (themePref === 'light' || themePref === 'dark') ? themePref : get().theme,
                budgetAlertsEnabled: budgetAlertsPref !== null ? budgetAlertsPref === 'true' : true,
                popupAlertsEnabled: popupAlertsPref !== null ? popupAlertsPref === 'true' : true,
                alertThreshold: alertThresholdPref !== null ? parseFloat(alertThresholdPref) : 0.8,
            };

            const data = await exportDatabaseToJSON(settings);
            const jsonString = JSON.stringify(data, null, 2);
            const fileName = `BanKoni_export_${Date.now()}.json`;
            const baseDirectory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
            if (!baseDirectory) throw new Error('No writable directory is available for the export.');
            const filePath = `${baseDirectory}${fileName}`;

            await FileSystem.writeAsStringAsync(filePath, jsonString, {
                encoding: FileSystem.EncodingType.UTF8,
            });

            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(filePath, {
                    mimeType: 'application/json',
                    dialogTitle: 'Export BanKoni data',
                    UTI: 'public.json',
                });
            }
            return fileName;
        } catch (error) {
            console.error('BanKoni export failed:', error);
            throw new Error(errorMessage(error, 'The data export failed.'));
        }
    },

    importDataFromJSON: async (payload: ExportDataPayload) => {
        try {
            const summary = await importDatabaseFromJSON(payload);

            // Restore user preferences if present in the backup
            if (summary.settings) {
                if (summary.settings.theme) {
                    await get().setTheme(summary.settings.theme);
                }
                if (summary.settings.budgetAlertsEnabled !== undefined) {
                    await SecureStore.setItemAsync('bankoni_budget_alerts_enabled', String(summary.settings.budgetAlertsEnabled));
                }
                if (summary.settings.popupAlertsEnabled !== undefined) {
                    await SecureStore.setItemAsync('bankoni_popup_alerts_enabled', String(summary.settings.popupAlertsEnabled));
                }
                if (summary.settings.alertThreshold !== undefined) {
                    await SecureStore.setItemAsync('bankoni_alert_threshold', String(summary.settings.alertThreshold));
                }
            }

            // Refresh all store collections directly from SQLite database
            const [wallets, categories, budgets, transactions, userRow] = await Promise.all([
                getWalletsDB(),
                getCategoriesDB(),
                getBudgetsDB(),
                getTransactionsDB(),
                getActiveUserDB(),
            ]);

            set({
                wallets,
                categories,
                budgets,
                transactions,
                user: userRow?.user ?? get().user,
            });

            return summary;
        } catch (error) {
            console.error('BanKoni import failed:', error);
            throw new Error(errorMessage(error, 'The backup restoration failed.'));
        }
    },

    totalIncome: () => getEtbClearedTransactions(get()).reduce(
        (sum, transaction) => sum + (transaction.type === 'CREDIT' ? transaction.amount : 0),
        0,
    ),

    totalExpenses: () => getEtbClearedTransactions(get()).reduce(
        (sum, transaction) => sum + (transaction.type === 'DEBIT' ? transaction.amount : 0),
        0,
    ),

    totalBalance: () => get().wallets
        .filter((wallet) => wallet.currency === 'ETB' && !wallet.isArchived)
        .reduce((sum, wallet) => sum + wallet.balance, 0),

    transactionByCategory: () => getEtbClearedTransactions(get()).reduce<Record<string, number>>(
        (totals, transaction) => {
            if (transaction.type === 'DEBIT') {
                totals[transaction.categoryId] = (totals[transaction.categoryId] ?? 0) + transaction.amount;
            }
            return totals;
        },
        {},
    ),

    setTheme: async (newTheme) => {
        set({ theme: newTheme });
        try {
            await SecureStore.setItemAsync('bankoni_theme', newTheme);
        } catch {
            // Ignore
        }
    },

    toggleTheme: async () => {
        const nextTheme = get().theme === 'light' ? 'dark' : 'light';
        set({ theme: nextTheme });
        try {
            await SecureStore.setItemAsync('bankoni_theme', nextTheme);
        } catch {
            // Ignore
        }
    },
}));

export default useBanKoniStore;
