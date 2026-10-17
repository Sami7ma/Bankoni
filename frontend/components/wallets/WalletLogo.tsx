// frontend/components/wallets/WalletLogo.tsx
// Renders vector SVG bank/mobile money logos or brand-colored fallback monograms.

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Banknote, Building2, Smartphone, WalletCards } from 'lucide-react-native';
import { getWalletProvider } from '../../constants/walletProviders';

interface WalletLogoProps {
    providerId?: string | null;
    size?: number;
    style?: StyleProp<ViewStyle>;
}

export default function WalletLogo({ providerId, size = 42, style }: WalletLogoProps) {
    const provider = getWalletProvider(providerId);
    const borderRadius = Math.round(size * 0.28);

    if (provider.svgXml) {
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
                    xml={provider.svgXml}
                    width={size * 0.9}
                    height={size * 0.9}
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
