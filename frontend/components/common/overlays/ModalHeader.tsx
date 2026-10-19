// components/common/overlays/ModalHeader.tsx
//
// Eyebrow + title on the left, close button on the right, with a bottom
// divider. Used inside <ModalShell>. Presentation only.

import { StyleSheet, Text, View } from 'react-native';

import useTheme from '../../../hooks/useTheme';
import CloseButton from '../buttons/CloseButton';

interface ModalHeaderProps {
    eyebrow: string;
    title: string;
    onClose: () => void;
}

export default function ModalHeader({ eyebrow, title, onClose }: ModalHeaderProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    return (
        <View style={styles.header}>
            <View>
                <Text style={styles.headerEyebrow}>{eyebrow}</Text>
                <Text style={styles.headerTitle}>{title}</Text>
            </View>
            <CloseButton onPress={onClose} />
        </View>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        header: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 22,
            paddingTop: 20,
            paddingBottom: 18,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        headerEyebrow: {
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 1.5,
            color: colors.champagne,
            marginBottom: 4,
        },
        headerTitle: {
            fontSize: 21,
            fontWeight: '700',
            color: colors.textPrimary,
            letterSpacing: -0.3,
        },
    });
