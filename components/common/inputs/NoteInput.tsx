// components/common/NoteInput.tsx
//
// A multiline text input for adding optional notes.
// Shows "Note" label with an "Optional" hint.
//
// WHERE IT'S USED:
// - AddTransactionModal (optional note like "Coffee at Tomoca")
// - Could be reused in transaction detail screens later
//
// WHY A COMPONENT?
// Keeps the modal files shorter and ensures consistent
// styling for all text areas in the app.

import { View, Text, TextInput, StyleSheet, } from 'react-native';
import useTheme from '../../../hooks/useTheme';

interface NoteInputProps {
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    label?: string;        // defaults to "Note"
}

export default function NoteInput({
    value,
    onChangeText,
    placeholder = 'Add a note...',
    label = 'Note',
}: NoteInputProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    return (
        <View style={styles.container}>
            {/* Label row — "Note" + "Optional" hint */}
            <Text style={styles.label}>
                {label}
                <Text style={styles.optional}> Optional</Text>
            </Text>

            {/* Multiline text input */}
            <TextInput
                style={styles.input}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={colors.textMuted}
                multiline             // allows multiple lines of text
                numberOfLines={2}     // shows 2 lines initially
                textAlignVertical="top"  // text starts at top, not center
            />
        </View>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        container: {
            gap: 8,
        },
        label: {
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 1,
            color: colors.textSecondary,
            textTransform: 'uppercase',
        },
        optional: {
            color: colors.textMuted,
        },
        input: {
            minHeight: 72,
            borderRadius: 14,
            borderWidth: 1,
            paddingHorizontal: 15,
            paddingTop: 13,
            paddingBottom: 12,
            fontSize: 14,
            lineHeight: 20,
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
            color: colors.textPrimary,
        },
    });
