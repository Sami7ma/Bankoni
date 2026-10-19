// components/common/overlays/ModalShell.tsx
//
// The shared "floating glass card" shell used by the BanKoni form modals:
// transparent fade Modal -> dimmed backdrop -> keyboard-avoiding layer ->
// rounded card with a subtle inner highlight ring.
//
// It owns ONLY presentation and dismissal wiring. Form state, validation,
// saving and deleting stay in the specialized modal that renders it.
//
// DISMISSAL: `onRequestClose` is called for the Android hardware back button
// AND for a tap on the backdrop (the pre-refactor modals used the same
// callback for both). The header close button is wired separately through
// <ModalHeader onClose>.

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import useTheme from '../../../hooks/useTheme';
import { alpha, radii } from '../../../constants/designTokens';

interface ModalShellProps {
    visible: boolean;
    onRequestClose: () => void;
    children: ReactNode;
}

export default function ModalShell({ visible, onRequestClose, children }: ModalShellProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onRequestClose}
            statusBarTranslucent
        >
            <View style={styles.modalRoot}>
                <Pressable style={styles.backdrop} onPress={onRequestClose} />

                <KeyboardAvoidingView
                    style={styles.keyboardLayer}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <View style={styles.container}>
                        <View pointerEvents="none" style={styles.glassHighlight} />
                        {children}
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
            maxWidth: 500,
            maxHeight: '88%',
            backgroundColor: colors.surface + alpha.modalSurface,
            borderColor: colors.champagne + alpha.modalBorder,
            borderRadius: radii.modal,
            borderWidth: 1,
            overflow: 'hidden',
            shadowOffset: { width: 0, height: 15 },
            shadowOpacity: 0.35,
            shadowRadius: 35,
            elevation: 25,
        },
        glassHighlight: {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            borderRadius: radii.modal,
            borderWidth: 1,
            pointerEvents: 'none',
            borderColor: colors.champagne + alpha.modalHighlight,
        },
    });
