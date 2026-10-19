// components/modals/AddCategoryModal.tsx
//
// Modal allowing users to create custom categories (Expense or Income).
// Cleanly differentiates Expense vs Income with dedicated icon catalogs,
// curated color palettes, quick suggestions, and a live category badge preview.

import { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Modal,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    Pressable,
} from 'react-native';
import {
    // Expense icons
    Utensils,
    Coffee,
    Pizza,
    ShoppingCart,
    Car,
    Fuel,
    Bus,
    Plane,
    Home,
    Zap,
    Droplets,
    Wifi,
    ShoppingBag,
    Shirt,
    Dumbbell,
    HeartPulse,
    Sparkles,
    Film,
    Gamepad2,
    BookOpen,
    Gift,
    PawPrint,
    Wrench,
    Receipt,
    // Income icons
    Banknote,
    Building2,
    Briefcase,
    Laptop,
    TrendingUp,
    Coins,
    PiggyBank,
    Landmark,
    HandCoins,
    Percent,
    Award,
    RotateCcw,
    Gem,
    Key,
    WalletCards,
    DollarSign,
    Check,
    LucideIcon,
} from 'lucide-react-native';

import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import type { Category, CategoryFlow } from '../../types/Category';
import CloseButton from '../common/buttons/CloseButton';
import PrimaryButton from '../common/buttons/PrimaryButton';

interface AddCategoryModalProps {
    visible: boolean;
    onClose: () => void;
    defaultFlow?: CategoryFlow;
    onCategoryCreated?: (category: Category) => void;
}

interface IconOption {
    key: string;
    label: string;
    Icon: LucideIcon;
}

interface SuggestionOption {
    name: string;
    iconKey: string;
    color: string;
}

// 24 Curated icons for spending / expenses
const EXPENSE_ICONS: IconOption[] = [
    // Dining & Food
    { key: 'shopping_cart', label: 'Groceries', Icon: ShoppingCart },
    { key: 'utensils', label: 'Dining', Icon: Utensils },
    { key: 'coffee', label: 'Cafe', Icon: Coffee },
    { key: 'pizza', label: 'Fast Food', Icon: Pizza },
    // Transport & Travel
    { key: 'car', label: 'Vehicle', Icon: Car },
    { key: 'fuel', label: 'Fuel', Icon: Fuel },
    { key: 'bus', label: 'Transit', Icon: Bus },
    { key: 'plane', label: 'Travel', Icon: Plane },
    // Housing & Living
    { key: 'home', label: 'Housing', Icon: Home },
    { key: 'zap', label: 'Utilities', Icon: Zap },
    { key: 'droplets', label: 'Water', Icon: Droplets },
    { key: 'wifi', label: 'Internet', Icon: Wifi },
    // Lifestyle & Health
    { key: 'shopping_bag', label: 'Shopping', Icon: ShoppingBag },
    { key: 'shirt', label: 'Apparel', Icon: Shirt },
    { key: 'dumbbell', label: 'Fitness', Icon: Dumbbell },
    { key: 'heart_pulse', label: 'Health', Icon: HeartPulse },
    { key: 'sparkles', label: 'Self Care', Icon: Sparkles },
    // Entertainment & Misc
    { key: 'film', label: 'Movies', Icon: Film },
    { key: 'gamepad_2', label: 'Gaming', Icon: Gamepad2 },
    { key: 'book_open', label: 'Education', Icon: BookOpen },
    { key: 'gift', label: 'Gifts', Icon: Gift },
    { key: 'paw_print', label: 'Pets', Icon: PawPrint },
    { key: 'wrench', label: 'Repairs', Icon: Wrench },
    { key: 'receipt', label: 'Bills', Icon: Receipt },
];

// 16 Curated icons for income & earnings
const INCOME_ICONS: IconOption[] = [
    // Salary & Career
    { key: 'banknote', label: 'Salary', Icon: Banknote },
    { key: 'building_2', label: 'Corporate', Icon: Building2 },
    { key: 'briefcase', label: 'Job', Icon: Briefcase },
    { key: 'laptop', label: 'Freelance', Icon: Laptop },
    // Wealth & Investments
    { key: 'trending_up', label: 'Investments', Icon: TrendingUp },
    { key: 'coins', label: 'Crypto/Gold', Icon: Coins },
    { key: 'piggy_bank', label: 'Savings', Icon: PiggyBank },
    { key: 'landmark', label: 'Dividends', Icon: Landmark },
    // Sales, Gigs & Inflow
    { key: 'hand_coins', label: 'Cash Tips', Icon: HandCoins },
    { key: 'percent', label: 'Commission', Icon: Percent },
    { key: 'award', label: 'Bonus', Icon: Award },
    { key: 'rotate_ccw', label: 'Refunds', Icon: RotateCcw },
    { key: 'gem', label: 'Royalties', Icon: Gem },
    { key: 'key', label: 'Rental', Icon: Key },
    { key: 'wallet_cards', label: 'Side Hustle', Icon: WalletCards },
    { key: 'dollar_sign', label: 'Earnings', Icon: DollarSign },
];

// Presets for rapid category creation
const EXPENSE_SUGGESTIONS: SuggestionOption[] = [
    { name: 'Groceries', iconKey: 'shopping_cart', color: '#FB8C00' },
    { name: 'Dining Out', iconKey: 'utensils', color: '#E53935' },
    { name: 'Coffee & Cafes', iconKey: 'coffee', color: '#C0905D' },
    { name: 'Fuel & Gas', iconKey: 'fuel', color: '#F4511E' },
    { name: 'Gym & Fitness', iconKey: 'dumbbell', color: '#00897B' },
    { name: 'Streaming & Subs', iconKey: 'film', color: '#8E24AA' },
    { name: 'Home Repairs', iconKey: 'wrench', color: '#546E7A' },
    { name: 'Pet Care', iconKey: 'paw_print', color: '#D81B60' },
];

const INCOME_SUGGESTIONS: SuggestionOption[] = [
    { name: 'Monthly Salary', iconKey: 'banknote', color: '#2E7D32' },
    { name: 'Freelance & Gigs', iconKey: 'laptop', color: '#1E88E5' },
    { name: 'Side Hustle', iconKey: 'hand_coins', color: '#C0905D' },
    { name: 'Rental Property', iconKey: 'key', color: '#00ACC1' },
    { name: 'Stock Dividends', iconKey: 'trending_up', color: '#43A047' },
    { name: 'Annual Bonus', iconKey: 'award', color: '#FB8C00' },
    { name: 'Refund / Cash Back', iconKey: 'rotate_ccw', color: '#546E7A' },
    { name: 'Crypto & Assets', iconKey: 'coins', color: '#8E24AA' },
];

const EXPENSE_COLORS = [
    '#E53935', // Crimson Red
    '#F4511E', // Warm Orange
    '#FB8C00', // Amber
    '#C0905D', // Champagne Gold
    '#8E24AA', // Purple
    '#D81B60', // Rose
    '#5E35B1', // Deep Indigo
    '#546E7A', // Slate
];

const INCOME_COLORS = [
    '#2E7D32', // Emerald Green
    '#43A047', // Vibrant Green
    '#00897B', // Teal
    '#00ACC1', // Cyan
    '#C0905D', // Champagne Gold
    '#1E88E5', // Ocean Blue
    '#FB8C00', // Warm Amber
    '#26A69A', // Jade Mint
];

export default function AddCategoryModal({
    visible,
    onClose,
    defaultFlow = 'EXPENSE',
    onCategoryCreated,
}: AddCategoryModalProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    const addCategory = useBanKoniStore((state) => state.addCategory);

    const [flow, setFlow] = useState<CategoryFlow>(defaultFlow);
    const [name, setName] = useState('');
    const [selectedIconKey, setSelectedIconKey] = useState('shopping_cart');
    const [selectedColor, setSelectedColor] = useState(EXPENSE_COLORS[0]);
    const [isSaving, setIsSaving] = useState(false);

    // Active catalogs based on flow
    const iconCatalog = flow === 'EXPENSE' ? EXPENSE_ICONS : INCOME_ICONS;
    const colorCatalog = flow === 'EXPENSE' ? EXPENSE_COLORS : INCOME_COLORS;
    const suggestionCatalog = flow === 'EXPENSE' ? EXPENSE_SUGGESTIONS : INCOME_SUGGESTIONS;

    useEffect(() => {
        if (visible) {
            setFlow(defaultFlow);
            setName('');
            if (defaultFlow === 'EXPENSE') {
                setSelectedIconKey('shopping_cart');
                setSelectedColor(EXPENSE_COLORS[0]);
            } else {
                setSelectedIconKey('banknote');
                setSelectedColor(INCOME_COLORS[0]);
            }
            setIsSaving(false);
        }
    }, [visible, defaultFlow]);

    const handleFlowChange = (newFlow: CategoryFlow) => {
        if (newFlow === flow) return;
        setFlow(newFlow);
        if (newFlow === 'EXPENSE') {
            setSelectedIconKey('shopping_cart');
            setSelectedColor(EXPENSE_COLORS[0]);
        } else {
            setSelectedIconKey('banknote');
            setSelectedColor(INCOME_COLORS[0]);
        }
    };

    const handleApplySuggestion = (s: SuggestionOption) => {
        setName(s.name);
        setSelectedIconKey(s.iconKey);
        setSelectedColor(s.color);
    };

    const handleSubmit = async () => {
        const trimmed = name.trim();
        if (!trimmed) {
            alert('Please enter a category name');
            return;
        }

        try {
            setIsSaving(true);
            const created = await addCategory({
                name: trimmed,
                iconKey: selectedIconKey,
                colorKey: selectedColor,
                flow,
                essential: false,
                recurring: false,
                isBuiltIn: false,
                isCustom: true,
            });

            onCategoryCreated?.(created);
            onClose();
        } catch (error) {
            alert('Failed to create category. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const activeIconItem =
        iconCatalog.find((item) => item.key === selectedIconKey) ?? iconCatalog[0];
    const ActiveIconComponent = activeIconItem.Icon;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <View style={styles.modalRoot}>
                <Pressable style={styles.backdrop} onPress={onClose} />

                <KeyboardAvoidingView
                    style={styles.keyboardLayer}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <View style={styles.container}>
                        <View pointerEvents="none" style={styles.glassHighlight} />

                        {/* HEADER */}
                        <View style={styles.header}>
                            <View>
                                <Text style={styles.headerEyebrow}>ORGANIZATION & BUDGETING</Text>
                                <Text style={styles.headerTitle}>
                                    {flow === 'EXPENSE' ? 'New Expense Category' : 'New Income Category'}
                                </Text>
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
                            {/* FLOW TOGGLE (EXPENSE vs INCOME) */}
                            <View style={styles.toggleContainer}>
                                <TouchableOpacity
                                    activeOpacity={0.8}
                                    onPress={() => handleFlowChange('EXPENSE')}
                                    style={[
                                        styles.toggleButton,
                                        flow === 'EXPENSE' && {
                                            borderColor: colors.danger,
                                            backgroundColor: colors.danger + '14',
                                        },
                                    ]}
                                >
                                    <View style={[styles.typeDot, { backgroundColor: colors.danger }]} />
                                    <Text
                                        style={[
                                            styles.toggleText,
                                            {
                                                color:
                                                    flow === 'EXPENSE'
                                                        ? colors.danger
                                                        : colors.textSecondary,
                                            },
                                        ]}
                                    >
                                        Expense Category
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    activeOpacity={0.8}
                                    onPress={() => handleFlowChange('INCOME')}
                                    style={[
                                        styles.toggleButton,
                                        flow === 'INCOME' && {
                                            borderColor: colors.success,
                                            backgroundColor: colors.success + '14',
                                        },
                                    ]}
                                >
                                    <View style={[styles.typeDot, { backgroundColor: colors.success }]} />
                                    <Text
                                        style={[
                                            styles.toggleText,
                                            {
                                                color:
                                                    flow === 'INCOME'
                                                        ? colors.success
                                                        : colors.textSecondary,
                                            },
                                        ]}
                                    >
                                        Income Category
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            {/* LIVE PREVIEW BADGE */}
                            <View style={styles.previewCard}>
                                <View
                                    style={[
                                        styles.previewIconBox,
                                        {
                                            backgroundColor: `${selectedColor}18`,
                                            borderColor: selectedColor,
                                        },
                                    ]}
                                >
                                    <ActiveIconComponent size={24} color={selectedColor} />
                                </View>
                                <View style={styles.previewInfo}>
                                    <Text style={styles.previewTitle} numberOfLines={1}>
                                        {name.trim() || (flow === 'EXPENSE' ? 'Expense Category Name' : 'Income Category Name')}
                                    </Text>
                                    <View style={styles.previewMetaRow}>
                                        <View
                                            style={[
                                                styles.flowBadge,
                                                {
                                                    backgroundColor:
                                                        flow === 'EXPENSE'
                                                            ? `${colors.danger}18`
                                                            : `${colors.success}18`,
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.flowBadgeText,
                                                    {
                                                        color:
                                                            flow === 'EXPENSE'
                                                                ? colors.danger
                                                                : colors.success,
                                                    },
                                                ]}
                                            >
                                                {flow}
                                            </Text>
                                        </View>
                                        <Text style={styles.previewIconName}>
                                            Icon: {activeIconItem.label}
                                        </Text>
                                    </View>
                                </View>
                            </View>

                            {/* QUICK SUGGESTIONS CHIPS */}
                            <View style={styles.fieldGroup}>
                                <Text style={styles.label}>QUICK SUGGESTIONS</Text>
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={styles.suggestionRow}
                                >
                                    {suggestionCatalog.map((s) => {
                                        const isMatch = name === s.name;
                                        return (
                                            <TouchableOpacity
                                                key={s.name}
                                                activeOpacity={0.7}
                                                style={[
                                                    styles.suggestionChip,
                                                    isMatch && {
                                                        borderColor: selectedColor,
                                                        backgroundColor: `${selectedColor}16`,
                                                    },
                                                ]}
                                                onPress={() => handleApplySuggestion(s)}
                                            >
                                                <View
                                                    style={[
                                                        styles.suggestionDot,
                                                        { backgroundColor: s.color },
                                                    ]}
                                                />
                                                <Text
                                                    style={[
                                                        styles.suggestionText,
                                                        isMatch && { color: selectedColor, fontWeight: '700' },
                                                    ]}
                                                >
                                                    {s.name}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>
                            </View>

                            {/* CATEGORY NAME INPUT */}
                            <View style={styles.fieldGroup}>
                                <Text style={styles.label}>CATEGORY NAME</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder={
                                        flow === 'EXPENSE'
                                            ? 'e.g. Dining Out, Fuel, Gym, Subscriptions'
                                            : 'e.g. Monthly Salary, Freelance, Dividends, Bonus'
                                    }
                                    placeholderTextColor={colors.textMuted}
                                    value={name}
                                    onChangeText={setName}
                                    maxLength={30}
                                    autoCapitalize="words"
                                />
                            </View>

                            {/* ICON SELECTOR */}
                            <View style={styles.fieldGroup}>
                                <View style={styles.labelRow}>
                                    <Text style={styles.label}>
                                        {flow === 'EXPENSE' ? 'EXPENSE ICONS' : 'INCOME ICONS'}
                                    </Text>
                                    <Text style={styles.counterText}>
                                        {iconCatalog.length} curated icons
                                    </Text>
                                </View>

                                <View style={styles.iconGrid}>
                                    {iconCatalog.map((item) => {
                                        const isSelected = selectedIconKey === item.key;
                                        const IconComp = item.Icon;
                                        return (
                                            <TouchableOpacity
                                                key={item.key}
                                                activeOpacity={0.7}
                                                style={[
                                                    styles.iconBox,
                                                    isSelected && {
                                                        borderColor: selectedColor,
                                                        backgroundColor: `${selectedColor}22`,
                                                    },
                                                ]}
                                                onPress={() => setSelectedIconKey(item.key)}
                                            >
                                                <IconComp
                                                    size={22}
                                                    color={isSelected ? selectedColor : colors.textSecondary}
                                                />
                                                <Text
                                                    style={[
                                                        styles.iconLabel,
                                                        isSelected && { color: selectedColor, fontWeight: '700' },
                                                    ]}
                                                    numberOfLines={1}
                                                >
                                                    {item.label}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </View>

                            {/* COLOR PALETTE */}
                            <View style={styles.fieldGroup}>
                                <Text style={styles.label}>ACCENT COLOR</Text>
                                <View style={styles.colorRow}>
                                    {colorCatalog.map((c) => {
                                        const isSelected = selectedColor === c;
                                        return (
                                            <TouchableOpacity
                                                key={c}
                                                activeOpacity={0.8}
                                                style={[
                                                    styles.colorCircle,
                                                    { backgroundColor: c },
                                                    isSelected && styles.colorCircleSelected,
                                                ]}
                                                onPress={() => setSelectedColor(c)}
                                            >
                                                {isSelected && <Check size={16} color="#FFFFFF" strokeWidth={3} />}
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </View>

                            {/* SUBMIT BUTTON */}
                            <PrimaryButton
                                label={isSaving ? 'Creating...' : `Create ${flow === 'EXPENSE' ? 'Expense' : 'Income'} Category`}
                                onPress={handleSubmit}
                                disabled={isSaving}
                                color={flow === 'EXPENSE' ? colors.danger : colors.success}
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
            maxWidth: 520,
            maxHeight: '92%',
            backgroundColor: colors.surface + 'FA',
            borderColor: colors.champagne + '55',
            borderRadius: 30,
            borderWidth: 1,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 16 },
            shadowOpacity: 0.4,
            shadowRadius: 28,
            elevation: 20,
        },
        glassHighlight: {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: 1,
            backgroundColor: 'rgba(255, 255, 255, 0.25)',
        },
        header: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            paddingHorizontal: 22,
            paddingTop: 22,
            paddingBottom: 12,
        },
        headerEyebrow: {
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 2,
            color: colors.champagne,
            marginBottom: 4,
        },
        headerTitle: {
            fontSize: 22,
            fontWeight: '700',
            color: colors.textPrimary,
        },
        scroll: {
            flexGrow: 0,
        },
        form: {
            paddingHorizontal: 22,
            paddingBottom: 24,
            gap: 16,
        },
        toggleContainer: {
            flexDirection: 'row',
            gap: 10,
        },
        toggleButton: {
            flex: 1,
            height: 44,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceAlt,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
        },
        typeDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
        },
        toggleText: {
            fontSize: 13,
            fontWeight: '600',
        },
        previewCard: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            padding: 14,
            borderRadius: 18,
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
        },
        previewIconBox: {
            width: 48,
            height: 48,
            borderRadius: 14,
            borderWidth: 1.5,
            alignItems: 'center',
            justifyContent: 'center',
        },
        previewInfo: {
            flex: 1,
            gap: 4,
        },
        previewTitle: {
            fontSize: 16,
            fontWeight: '700',
            color: colors.textPrimary,
        },
        previewMetaRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        flowBadge: {
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 6,
        },
        flowBadgeText: {
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 0.5,
        },
        previewIconName: {
            fontSize: 12,
            color: colors.textSecondary,
        },
        fieldGroup: {
            gap: 8,
        },
        labelRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        label: {
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 1,
            color: colors.textSecondary,
            textTransform: 'uppercase',
        },
        counterText: {
            fontSize: 11,
            fontWeight: '500',
            color: colors.textMuted,
        },
        suggestionRow: {
            gap: 8,
            paddingVertical: 2,
        },
        suggestionChip: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceAlt,
        },
        suggestionDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
        },
        suggestionText: {
            fontSize: 12,
            fontWeight: '500',
            color: colors.textPrimary,
        },
        input: {
            height: 52,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceAlt,
            paddingHorizontal: 16,
            fontSize: 15,
            fontWeight: '500',
            color: colors.textPrimary,
        },
        iconGrid: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
        },
        iconBox: {
            width: '23%',
            aspectRatio: 1,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 4,
            gap: 4,
        },
        iconLabel: {
            fontSize: 10,
            fontWeight: '500',
            color: colors.textSecondary,
            textAlign: 'center',
        },
        colorRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 4,
        },
        colorCircle: {
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
        },
        colorCircleSelected: {
            borderWidth: 2.5,
            borderColor: '#FFFFFF',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.35,
            shadowRadius: 4,
            elevation: 4,
        },
    });
