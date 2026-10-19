// components/home/BalanceCards.tsx
//
// Single glassmorphism balance card.
// - Dark mode: deep dark navy frosted glass
// - Light mode: light champagne frosted glass
// - No swiping — one card only
// - 4 stat pills instead of dots: Balance (gold) | Income (green) | Expenses (red) | % ratio

import { forwardRef, useImperativeHandle } from 'react';
import { View, Text, StyleSheet, Platform, Dimensions } from 'react-native';
import { Nfc } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 20;

export interface BalanceCardsRef {
    scrollToIncome: () => void;
    scrollToExpense: () => void;
    scrollToBalance: () => void;
}

interface BalanceCardsProps {
    userName: string;
    totalBalance: number;
    totalIncome: number;
    totalExpenses: number;
}

const formatMoney = (amount: number) =>
    `ETB ${Math.abs(amount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

const BalanceCards = forwardRef<BalanceCardsRef, BalanceCardsProps>(
    ({ userName, totalBalance, totalIncome, totalExpenses }, ref) => {
        const colors = useTheme();
        const theme = useBanKoniStore((state) => state.theme);

        // No-op scroll methods — kept so HomeScreen ref calls still work
        useImperativeHandle(ref, () => ({
            scrollToIncome: () => { },
            scrollToBalance: () => { },
            scrollToExpense: () => { },
        }));

        const spendRatio =
            totalIncome > 0
                ? Math.min((totalExpenses / totalIncome) * 100, 999)
                : 0;

        const isDark = theme === 'dark';

        // Gradient: all 3 stops now live in theme as cardGlassFrom/Via/To
        const cardGradient: [string, string, ...string[]] = [
            colors.cardGlassFrom,
            colors.cardGlassVia,
            colors.cardGlassTo,
        ];

        const chipBg = isDark ? colors.champagne : colors.subtleGold;
        const chipLineColor = colors.cardChipLine;
        const cardBorderColor = colors.cardBorder;
        const glassHighlight = colors.cardGlow;

        return (
            <View style={styles.wrapper}>
                <LinearGradient
                    colors={cardGradient}
                    start={{ x: 0.0, y: 0.0 }}
                    end={{ x: 1.0, y: 1.0 }}
                    style={[
                        styles.card,
                        {
                            borderColor: cardBorderColor,
                            shadowColor: isDark ? '#000000' : colors.champagne,
                        },
                    ]}
                >
                    {/* Glass catch-light stripe */}
                    <View style={[styles.glassHighlight, { backgroundColor: glassHighlight }]} />

                    {/* TOP: Logo + NFC */}
                    <View style={styles.topRow}>
                        <Text style={[styles.logo, { color: colors.textPrimary }]}>BanKoni</Text>
                        <Nfc size={20} color={colors.champagne} />
                    </View>

                    {/* CHIP */}
                    <View style={[styles.chip, { backgroundColor: chipBg }]}>
                        <View style={styles.chipLines}>
                            {[0, 1, 2].map((i) => (
                                <View key={i} style={[styles.chipLine, { backgroundColor: chipLineColor }]} />
                            ))}
                        </View>
                    </View>

                    {/* 4 STAT PILLS — replaces old dots */}
                    <View style={styles.pillsRow}>
                        {/* Balance — gold */}
                        <View style={styles.pill}>

                            <View>
                                <Text style={[styles.pillLabel, { color: colors.textMuted }]}>Balance</Text>
                                <Text style={[styles.pillAmount, { color: colors.champagne }]} numberOfLines={1} adjustsFontSizeToFit>
                                    {formatMoney(totalBalance)}
                                </Text>
                            </View>
                        </View>

                        {/* Income — green */}
                        <View style={styles.pill}>

                            <View>
                                <Text style={[styles.pillLabel, { color: colors.textMuted }]}>Income</Text>
                                <Text style={[styles.pillAmount, { color: colors.success }]} numberOfLines={1} adjustsFontSizeToFit>
                                    {formatMoney(totalIncome)}
                                </Text>
                            </View>
                        </View>

                        {/* Spent — red */}
                        <View style={styles.pill}>

                            <View>
                                <Text style={[styles.pillLabel, { color: colors.textMuted }]}>Spent</Text>
                                <Text style={[styles.pillAmount, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
                                    {formatMoney(totalExpenses)}
                                </Text>
                            </View>
                        </View>

                        {/* Ratio — muted */}
                        <View style={styles.pill}>

                            <View>
                                <Text style={[styles.pillLabel, { color: colors.textMuted }]}>Ratio</Text>
                                <Text style={[styles.pillAmount, { color: colors.textSecondary }]}>
                                    {spendRatio.toFixed(1)}%
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* BOTTOM: Cardholder + Brand */}
                    <View style={styles.bottomRow}>
                        <Text style={[styles.cardHolder, { color: colors.textPrimary }]}>
                            {userName.toUpperCase()}
                        </Text>
                        <Text style={[styles.cardBrand, { color: colors.champagne }]}>BANKONI</Text>
                    </View>
                </LinearGradient>
            </View>
        );
    }
);

export default BalanceCards;

const styles = StyleSheet.create({
    wrapper: { marginBottom: 4 },
    card: {
        width: CARD_WIDTH,
        borderRadius: 20,
        paddingHorizontal: 15,
        paddingVertical: 12,
        borderWidth: 1,
        overflow: 'hidden',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 18,
        elevation: 10,
        gap: 10,
    },
    glassHighlight: {
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: 60,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    logo: {
        fontStyle: 'italic',
        fontFamily: Platform.OS === 'ios' ? 'Snell Roundhand' : 'cursive',
        fontSize: 26,
        fontWeight: '500',
        top: -4,
    },
    chip: {
        width: 40,
        height: 26,
        borderRadius: 6,
        justifyContent: 'center',
        paddingHorizontal: 6,
        opacity: 0.9
    },
    chipLines: {
        flex: 1,
        justifyContent: 'space-around'
    },
    chipLine: {
        height: 2,
        borderRadius: 3
    },
    pillsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingTop: 15,
        gap: 6,
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 4,
        flex: 1
    },
    pillLabel: {
        fontSize: 9,
        letterSpacing: 0.5,
        fontWeight: '500',
        textTransform: 'uppercase'
    },
    pillAmount: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.3,
        marginTop: 1
    },
    bottomRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 2,
        top: 4,
    },
    cardHolder: {
        fontSize: 12,
        letterSpacing: 1.2,
        fontWeight: '600'
    },
    cardBrand: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5
    },
});