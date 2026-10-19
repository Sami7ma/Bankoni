// components/common/icons/CategoryIcon.tsx
//
// Centralized category icon renderer.
// Supports both built-in legacy keys (e.g. 'local_gas_station', 'payments')
// and modern Lucide icon keys (e.g. 'fuel', 'banknote', 'utensils').

import React from 'react';
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
    MoreHorizontal,
    Tv,
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
    LucideIcon,
} from 'lucide-react-native';
import type { CategoryFlow } from '../../../types/Category';

interface CategoryIconProps {
    iconKey?: string | null;
    color?: string;
    size?: number;
    flow?: CategoryFlow;
}

const ICON_MAP: Record<string, LucideIcon> = {
    // Expense - Dining & Food
    utensils: Utensils,
    restaurant: Utensils,
    coffee: Coffee,
    free_breakfast: Coffee,
    pizza: Pizza,
    fastfood: Pizza,
    shopping_cart: ShoppingCart,
    groceries: ShoppingCart,

    // Expense - Transport
    car: Car,
    directions_car: Car,
    fuel: Fuel,
    local_gas_station: Fuel,
    gas: Fuel,
    bus: Bus,
    directions_bus: Bus,
    plane: Plane,
    flight: Plane,

    // Expense - Housing & Utilities
    home: Home,
    house: Home,
    zap: Zap,
    bolt: Zap,
    utilities: Zap,
    droplets: Droplets,
    water_drop: Droplets,
    wifi: Wifi,
    internet: Wifi,

    // Expense - Lifestyle & Personal
    shopping_bag: ShoppingBag,
    shopping: ShoppingBag,
    shirt: Shirt,
    checkroom: Shirt,
    clothing: Shirt,
    dumbbell: Dumbbell,
    fitness_center: Dumbbell,
    gym: Dumbbell,
    heart_pulse: HeartPulse,
    health_and_safety: HeartPulse,
    health: HeartPulse,
    sparkles: Sparkles,
    spa: Sparkles,
    auto_awesome: Sparkles,

    // Expense - Entertainment & Misc
    film: Film,
    movie: Film,
    tv: Tv,
    subscriptions: Film,
    gamepad_2: Gamepad2,
    sports_esports: Gamepad2,
    book_open: BookOpen,
    book: BookOpen,
    school: BookOpen,
    gift: Gift,
    card_giftcard: Gift,
    paw_print: PawPrint,
    pets: PawPrint,
    wrench: Wrench,
    build: Wrench,
    receipt: Receipt,
    receipt_long: Receipt,
    more_horiz: MoreHorizontal,
    more_horizontal: MoreHorizontal,

    // Income - Salary & Work
    banknote: Banknote,
    payments: Banknote,
    dollar_sign: DollarSign,
    building_2: Building2,
    corporate: Building2,
    briefcase: Briefcase,
    work: Briefcase,
    laptop: Laptop,
    computer: Laptop,

    // Income - Wealth & Assets
    trending_up: TrendingUp,
    investment: TrendingUp,
    coins: Coins,
    paid: Coins,
    piggy_bank: PiggyBank,
    savings: PiggyBank,
    landmark: Landmark,
    account_balance: Landmark,

    // Income - Sales, Gigs & Inflow
    hand_coins: HandCoins,
    percent: Percent,
    award: Award,
    military_tech: Award,
    rotate_ccw: RotateCcw,
    replay: RotateCcw,
    gem: Gem,
    diamond: Gem,
    key: Key,
    real_estate: Key,
    wallet_cards: WalletCards,
    credit_card: WalletCards,
};

export default function CategoryIcon({
    iconKey,
    color = '#C0905D',
    size = 20,
    flow = 'EXPENSE',
}: CategoryIconProps) {
    const key = (iconKey || '').toLowerCase().trim();
    const ResolvedIcon = ICON_MAP[key] ?? (flow === 'INCOME' ? Banknote : ShoppingBag);

    return <ResolvedIcon size={size} color={color} />;
}
