// components/common/buttons/PeriodTabs.tsx
//
// Animated liquid glass period selector matching the Accounts/Transactions
// switcher from LedgerScreen.
// Shows three tabs: Week | Month | Year with fluid glass pill animation.

import { useRef, useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import useTheme from '../../../hooks/useTheme';

export type Period = 'Week' | 'Month' | 'Year';
const PERIODS: Period[] = ['Week', 'Month', 'Year'];

interface PeriodTabsProps {
    selected: Period;
    onSelect: (period: Period) => void;
}

export default function PeriodTabs({ selected, onSelect }: PeriodTabsProps) {
    const colors = useTheme();
    const isDark = colors.statusBar === 'light';
    const styles = createStyles(colors, isDark);

    const activeIndex = PERIODS.indexOf(selected);
    const [containerWidth, setContainerWidth] = useState(0);
    const segmentAnim = useRef(new Animated.Value(activeIndex)).current;

    useEffect(() => {
        Animated.spring(segmentAnim, {
            toValue: activeIndex,
            tension: 70,
            friction: 10,
            useNativeDriver: true,
        }).start();
    }, [activeIndex]);

    const tabWidth = containerWidth > 0 ? (containerWidth - 6) / 3 : 0;

    return (
        <View style={styles.segmentWrapper}>
            <View
                style={styles.segmentContainer}
                onLayout={(e) => {
                    const w = e.nativeEvent.layout.width;
                    if (w && Math.abs(w - containerWidth) > 1) {
                        setContainerWidth(w);
                    }
                }}
            >
                {/* Animated Liquid Glass Bubble */}
                {containerWidth > 0 && (
                    <Animated.View
                        style={[
                            styles.segmentBubble,
                            {
                                width: Math.max(tabWidth, 0),
                                transform: [
                                    {
                                        translateX: segmentAnim.interpolate({
                                            inputRange: [0, 1, 2],
                                            outputRange: [0, tabWidth, tabWidth * 2],
                                        }),
                                    },
                                ],
                            },
                        ]}
                        pointerEvents="none"
                    >
                        <LinearGradient
                            colors={
                                isDark
                                    ? ['rgba(255, 255, 255, 0.16)', 'rgba(255, 255, 255, 0.06)']
                                    : ['rgba(255, 255, 255, 0.96)', 'rgba(255, 255, 255, 0.85)']
                            }
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={StyleSheet.absoluteFill}
                        />
                        <View style={styles.segmentBubbleSheen} />
                    </Animated.View>
                )}

                {/* Tab buttons */}
                {PERIODS.map((p) => {
                    const isActive = selected === p;
                    return (
                        <TouchableOpacity
                            key={p}
                            style={styles.segmentBtn}
                            onPress={() => onSelect(p)}
                            activeOpacity={0.8}
                        >
                            <Text
                                style={[
                                    styles.segmentBtnText,
                                    isActive && styles.segmentBtnTextActive,
                                ]}
                            >
                                {p}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>, isDark: boolean) =>
    StyleSheet.create({
        segmentWrapper: {
            marginTop: 2,
            marginBottom: 2,
        },
        segmentContainer: {
            flexDirection: 'row',
            height: 38,
            borderRadius: 19,
            padding: 2,
            backgroundColor: 'transparent',
            overflow: 'hidden',
            position: 'relative',
        },
        segmentBubble: {
            position: 'absolute',
            top: 2,
            bottom: 2,
            left: 2,
            borderRadius: 17,
            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.06)',
            borderWidth: 1,
            borderColor: isDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(0, 0, 0, 0.08)',
            overflow: 'hidden',
        },
        segmentBubbleSheen: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '46%',
            borderTopLeftRadius: 17,
            borderTopRightRadius: 17,
            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.35)',
        },
        segmentBtn: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            borderRadius: 17,
            zIndex: 2,
        },
        segmentBtnText: {
            fontSize: 13.5,
            fontWeight: '600',
            color: colors.textSecondary,
        },
        segmentBtnTextActive: {
            color: colors.champagne,
            fontWeight: '700',
        },
    });
