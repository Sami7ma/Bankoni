// components/common/charts/PeriodTabs.tsx
//
// Animated period selector with a sliding gold highlight.
// Shows three tabs: Week | Month | Year
//
// HOW THE ANIMATION WORKS:
// We use Animated.Value to track which tab is active (0, 1, or 2).
// When the user taps a tab, Animated.timing smoothly slides
// the gold background indicator from one tab position to another.
//
// useRef(new Animated.Value(1)) — starts at index 1 (Month)
// because that's the default selected period.
//
// interpolate() maps the animated value to pixel positions:
//   0 → left edge (Week)
//   1 → middle (Month)
//   2 → right edge (Year)
//
// useNativeDriver: true — runs the animation on the native thread
// so it stays smooth even if JS is busy computing chart data.
//
// WHY A SEPARATE COMPONENT?
// The animated tab logic is 30+ lines of animation code.
// AnalyticsScreen shouldn't care about slide animations — it just
// needs to know WHICH period is selected. This component owns
// the animation, the parent owns the state.

import { useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Animated,
    Easing,
    Dimensions,
} from 'react-native';
import useTheme from '../../../hooks/useTheme';

// ── CONSTANTS ────────────────────────────────────────────
// Each tab is 1/3 of the container width (minus padding).
const TAB_WIDTH = (Dimensions.get('window').width - 28) / 3;

// The three period options
type Period = 'Week' | 'Month' | 'Year';
const PERIODS: Period[] = ['Week', 'Month', 'Year'];

// ── PROPS ────────────────────────────────────────────────
// selected = which tab is currently active
// onSelect = callback when user taps a tab
interface PeriodTabsProps {
    selected: Period;
    onSelect: (period: Period) => void;
}

export default function PeriodTabs({ selected, onSelect }: PeriodTabsProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    // Animated value that controls the gold indicator position.
    // Starts at 1 (Month) because that's the default.
    const defaultIndex = PERIODS.indexOf(selected);
    const tabPosition = useRef(new Animated.Value(defaultIndex)).current;

    // When a tab is tapped:
    // 1. Animate the gold indicator to the new position
    // 2. Tell the parent which period was selected
    const handlePress = (period: Period) => {
        const index = PERIODS.indexOf(period);

        Animated.timing(tabPosition, {
            toValue: index,
            duration: 350,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();

        onSelect(period);
    };

    return (
        <View style={styles.container}>
            {/* ANIMATED GOLD INDICATOR — slides behind the active tab */}
            <Animated.View
                style={[
                    styles.indicator,
                    {
                        transform: [
                            {
                                translateX: tabPosition.interpolate({
                                    inputRange: [0, 1, 2],
                                    outputRange: [0, TAB_WIDTH, TAB_WIDTH * 2],
                                }),
                            },
                        ],
                    },
                ]}
            />

            {/* TAB BUTTONS */}
            {PERIODS.map((p) => (
                <TouchableOpacity
                    key={p}
                    style={styles.tab}
                    onPress={() => handlePress(p)}
                    activeOpacity={0.8}
                >
                    <Text
                        style={[
                            styles.tabText,
                            selected === p && styles.tabTextActive,
                        ]}
                    >
                        {p}
                    </Text>
                </TouchableOpacity>
            ))}
        </View>
    );
}

// ── STYLES ───────────────────────────────────────────────
const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        container: {
            flexDirection: 'row',
            backgroundColor: colors.surface,
            borderRadius: 12,
            padding: 4,
            position: 'relative',
        },
        indicator: {
            position: 'absolute',
            top: 4,
            bottom: 4,
            width: '31%',
            borderRadius: 10,
            backgroundColor: colors.champagne,
        },
        tab: {
            flex: 1,
            paddingVertical: 10,
            borderRadius: 10,
            alignItems: 'center',
            zIndex: 1,
        },
        tabText: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textSecondary,
        },
        tabTextActive: {
            color: colors.background,
        },
    });
