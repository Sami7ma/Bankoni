// components/common/CloseButton.tsx
//
// A small circular button with an X icon.
// Used in modal headers to dismiss the modal.
//
// WHERE IT'S USED:
// - AddTransactionModal (top-right corner)
// - AddBudgetModal (top-right corner)
//
// WHY A COMPONENT?
// Both modals have the exact same X button with identical styling.
// If we ever want to change the size or add a haptic feedback,
// we do it once here.

import {
    TouchableOpacity,
    StyleSheet,
} from 'react-native';
import { X } from 'lucide-react-native';
import useTheme from '../../../hooks/useTheme';


// Props — only needs an onPress handler
interface CloseButtonProps {
    onPress: () => void;
}

export default function CloseButton({ onPress }: CloseButtonProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    return (
        <TouchableOpacity
            onPress={onPress}
            style={styles.button}
            activeOpacity={0.7}
        >
            {/* X icon from lucide — the "close" symbol */}
            <X size={20} color={colors.textSecondary} strokeWidth={2} />
        </TouchableOpacity>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        button: {
            width: 38,
            height: 38,
            borderRadius: 19,          // half of width = perfect circle
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
        },
    });
