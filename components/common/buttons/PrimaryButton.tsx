
// components/common/PrimaryButton.tsx
//
// A full-width, rounded, bold button used across the entire app.
//
// WHERE IT'S USED:
// - LoginScreen       → "Sign In"
// - RegisterScreen    → "Create Account"
// - OnboardingScreen  → "Next" / "Get Started"
// - AddTransactionModal → "Add Income" / "Add Expense"
// - AddBudgetModal    → "Create Budget"
//
// PROPS:
// - label: the text displayed on the button
// - onPress: function to call when tapped
// - color?: optional background color (defaults to champagne/gold)
// - style?: optional extra styles (e.g. marginTop, width)

import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import useTheme from "../../../hooks/useTheme";

// Props interface — defines what the parent can pass to this component
interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  color?: string;       // Optional — defaults to colors.champagne
  style?: ViewStyle;    // Optional — extra styles from the parent
  disabled?: boolean;
  loading?: boolean;
}
export default function PrimaryButton({
  label,
  onPress,
  color,
  style,
  disabled = false,
  loading = false,
}: PrimaryButtonProps) {
  const colors = useTheme();
  const styles = createStyles(colors);

  const isBlocked = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        styles.button,
        color ? { backgroundColor: color, shadowColor: color } : null,
        isBlocked && styles.buttonDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={isBlocked}
      activeOpacity={isBlocked ? 1 : 0.7}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.surface} />
      ) : (
        <Text style={styles.text}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    button: {
      backgroundColor: colors.champagne,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
      // Add a subtle shadow for depth
      shadowColor: colors.champagne,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    buttonDisabled: {
      backgroundColor: colors.textMuted, // Gray out the button
      shadowOpacity: 0,
      elevation: 0,
    },
    text: {
      color: colors.surface, // Dark text on gold button
      fontSize: 16,
      fontWeight: "700",
      letterSpacing: 0.5,
    },
  });
