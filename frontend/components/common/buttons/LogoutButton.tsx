// components/common/buttons/LogoutButton.tsx
import { TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Lock } from 'lucide-react-native';
import useTheme from '../../../hooks/useTheme';
import useBanKoniStore from '../../../store/useBanKoniStore';

export default function LogoutButton() {
    const colors = useTheme();
    const styles = createStyles(colors);
    const logOut = useBanKoniStore((state) => state.logOut);

    const handlePress = () => {
        Alert.alert(
            'Log Out',
            'Are you sure you want to log out of your account?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Log Out',
                    style: 'destructive',
                    onPress: async () => {
                        await logOut();
                    },
                },
            ]
        );
    };

    return (
        <TouchableOpacity
            style={styles.button}
            onPress={handlePress}
            activeOpacity={0.7}
        >
            <Lock size={20} color={colors.champagne} />
        </TouchableOpacity>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        button: {
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: colors.border,
        },
    });
