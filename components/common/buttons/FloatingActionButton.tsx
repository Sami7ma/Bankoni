// components/common/FloatingActionButton.tsx
//
// A circular gold button with a + icon inside.
// Typically placed in the top-right of a screen header.
//
// WHERE IT'S USED:
// - BudgetsScreen (tap + to add new budget)
// - Future screens that need an "add" action
//
// WHY A COMPONENT?
// This pattern will appear on many screens as the app grows.
// Having it as a component means consistent sizing, color,
// and behavior everywhere.

import { ReactNode } from 'react';
import {
    TouchableOpacity,
    StyleSheet,
    ViewStyle,
} from 'react-native';
import { Plus } from 'lucide-react-native';
import useTheme from '../../../hooks/useTheme';

interface FloatingActionButtonProps {
    onPress: () => void;
    icon?: ReactNode;     // Optional custom icon (defaults to Plus)
    style?: ViewStyle;    // Optional extra styles
}

export default function FloatingActionButton({
    onPress,
    icon,
    style,
}: FloatingActionButtonProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    return (
        <TouchableOpacity
            style={[styles.button, style]}
            onPress={onPress}
            activeOpacity={0.8}
        >
            {/* If no custom icon is provided, show a Plus icon */}
            {icon ?? <Plus size={20} color={colors.background} />}
        </TouchableOpacity>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        button: {
            width: 44,
            height: 44,
            borderRadius: 22,              // half of width = perfect circle
            backgroundColor: colors.champagne,
            alignItems: 'center',
            justifyContent: 'center',
        },
    });
