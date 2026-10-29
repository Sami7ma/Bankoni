// components/navigation/LiquidGlassTabBar.tsx
// Refined, production-grade bottom navigation bar inspired by Telegram and Instagram on iOS.
// Full-width anchored bar with a restrained translucent surface, top hairline border,
// native safe-area insets, keyboard avoidance, and WCAG-compliant accessibility.

import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Platform,
    Keyboard,
} from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    Home,
    Wallet as WalletIcon,
    PiggyBank,
    BarChart,
    Settings as SettingsIcon,
} from 'lucide-react-native';
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';

export default function LiquidGlassTabBar({
    state,
    descriptors,
    navigation,
}: BottomTabBarProps) {
    const insets = useSafeAreaInsets();
    const colors = useTheme();
    const theme = useBanKoniStore((s) => s.theme);
    const isDark = theme === 'dark';

    // Keyboard avoidance: hide tab bar when software keyboard is visible
    const [isKeyboardVisible, setKeyboardVisible] = useState(false);

    useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
        const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));

        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    if (isKeyboardVisible) {
        return null;
    }

    const renderDefaultIcon = (name: string, color: string, focused: boolean) => {
        const iconSize = 22;
        const strokeWidth = focused ? 2.3 : 1.75;

        switch (name) {
            case 'Home':
                return <Home size={iconSize} color={color} strokeWidth={strokeWidth} />;
            case 'Ledger':
                return <WalletIcon size={iconSize} color={color} strokeWidth={strokeWidth} />;
            case 'Budgets':
                return <PiggyBank size={iconSize} color={color} strokeWidth={strokeWidth} />;
            case 'Analytics':
                return <BarChart size={iconSize} color={color} strokeWidth={strokeWidth} />;
            case 'Settings':
                return <SettingsIcon size={iconSize} color={color} strokeWidth={strokeWidth} />;
            default:
                return null;
        }
    };

    const contentHeight = Platform.OS === 'ios' ? 49 : 56;
    const barHeight = contentHeight + insets.bottom;

    return (
        <View
            style={[
                styles.wrapper,
                {
                    height: barHeight,
                    paddingBottom: insets.bottom,
                    backgroundColor: isDark
                        ? 'rgba(18, 26, 40, 0.94)'
                        : 'rgba(255, 255, 255, 0.94)',
                    borderTopColor: isDark
                        ? 'rgba(255, 255, 255, 0.10)'
                        : 'rgba(0, 0, 0, 0.08)',
                },
            ]}
            pointerEvents="box-none"
        >
            <View style={[styles.tabsRow, { height: contentHeight }]}>
                {state.routes.map((route, index) => {
                    const { options } = descriptors[route.key];
                    const isFocused = state.index === index;

                    const rawLabel =
                        options.tabBarLabel !== undefined
                            ? options.tabBarLabel
                            : options.title !== undefined
                            ? options.title
                            : route.name;

                    const labelText =
                        typeof rawLabel === 'string'
                            ? rawLabel
                            : route.name;

                    const activeColor = colors.champagne;
                    const inactiveColor = colors.textSecondary;
                    const itemColor = isFocused ? activeColor : inactiveColor;

                    const onPress = () => {
                        const event = navigation.emit({
                            type: 'tabPress',
                            target: route.key,
                            canPreventDefault: true,
                        });

                        if (!isFocused && !event.defaultPrevented) {
                            navigation.navigate(route.name, route.params);
                        }
                    };

                    const onLongPress = () => {
                        navigation.emit({
                            type: 'tabLongPress',
                            target: route.key,
                        });
                    };

                    const accessibilityLabel =
                        options.tabBarAccessibilityLabel ||
                        `${labelText}, tab, ${index + 1} of ${state.routes.length}`;

                    return (
                        <TouchableOpacity
                            key={route.key}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: isFocused }}
                            accessibilityLabel={accessibilityLabel}
                            testID={options.tabBarButtonTestID || `tab-${route.name.toLowerCase()}`}
                            onPress={onPress}
                            onLongPress={onLongPress}
                            activeOpacity={0.7}
                            style={styles.tabItem}
                        >
                            <View style={styles.iconContainer}>
                                {options.tabBarIcon
                                    ? options.tabBarIcon({
                                          focused: isFocused,
                                          color: itemColor,
                                          size: 22,
                                      })
                                    : renderDefaultIcon(route.name, itemColor, isFocused)}
                            </View>

                            {typeof rawLabel === 'function' ? (
                                rawLabel({
                                    focused: isFocused,
                                    color: itemColor,
                                    position: 'below-icon',
                                    children: route.name,
                                })
                            ) : (
                                <Text
                                    numberOfLines={1}
                                    style={[
                                        styles.tabLabel,
                                        {
                                            color: itemColor,
                                            fontWeight: isFocused ? '600' : '500',
                                        },
                                    ]}
                                >
                                    {labelText}
                                </Text>
                            )}
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    tabsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        width: '100%',
    },
    tabItem: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 44,
        paddingTop: 4,
        paddingBottom: 2,
    },
    iconContainer: {
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    tabLabel: {
        fontSize: 10,
        lineHeight: 12,
        marginTop: 3,
        textAlign: 'center',
        letterSpacing: 0.15,
    },
});
