import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Banknote, Building2, Smartphone, WalletCards } from 'lucide-react-native';
import { getWalletProvider } from '../../constants/walletProviders';
import { BANK_SVG_LOGOS_DARK } from '../../constants/bankLogosSvg';
import useBanKoniStore from '../../store/useBanKoniStore';

interface WalletLogoProps {
    providerId?: string | null;
    size?: number;
    style?: StyleProp<ViewStyle>;
}

export default function WalletLogo({ providerId, size = 42, style }: WalletLogoProps) {
    const provider = getWalletProvider(providerId);
    const theme = useBanKoniStore((state) => state.theme);
    const isDark = theme === 'dark';
    const borderRadius = Math.round(size * 0.28);

    const svgXml = (isDark && provider.id && BANK_SVG_LOGOS_DARK[provider.id])
        ? BANK_SVG_LOGOS_DARK[provider.id]
        : provider.svgXml;

    if (svgXml) {
        return (
            <View
                style={[
                    styles.container,
                    {
                        width: size,
                        height: size,
                        borderRadius,
                        backgroundColor: 'transparent',
                        borderColor: 'transparent',
                    },
                    style,
                ]}
            >
                <SvgXml
                    xml={svgXml}
                    width={size}
                    height={size}
                />
            </View>
        );
    }

    // Fallback renders for Cash, M-Pesa (pending user logo), and Custom
    const renderFallbackIcon = () => {
        const iconSize = Math.round(size * 0.52);
        switch (provider.type) {
            case 'cash':
                return <Banknote size={iconSize} color="#FFFFFF" />;
            case 'mobile_money':
                return <Smartphone size={iconSize} color="#FFFFFF" />;
            case 'bank':
                return <Building2 size={iconSize} color="#FFFFFF" />;
            default:
                return <WalletCards size={iconSize} color="#FFFFFF" />;
        }
    };

    return (
        <View
            style={[
                styles.container,
                {
                    width: size,
                    height: size,
                    borderRadius,
                    backgroundColor: provider.brandColor,
                },
                style,
            ]}
        >
            {renderFallbackIcon()}
            {provider.id === 'mpesa' && (
                <View style={styles.mpBadge}>
                    <Text style={styles.mpText}>MP</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.12)',
    },
    mpBadge: {
        position: 'absolute',
        bottom: 2,
        right: 2,
        backgroundColor: '#000000',
        borderRadius: 4,
        paddingHorizontal: 3,
        paddingVertical: 1,
    },
    mpText: {
        color: '#FFFFFF',
        fontSize: 8,
        fontWeight: '700',
    },
});
