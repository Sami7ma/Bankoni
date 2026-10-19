import { useCallback, useRef, useState } from 'react';
import {
    Dimensions,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    type ListRenderItem,
    type ViewToken,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ChartNoAxesCombined, Target, WalletCards } from 'lucide-react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { AuthStackParamList } from '../navigation/AppNavigator';
import useTheme from '../../hooks/useTheme';
import PrimaryButton from '../../components/common/buttons/PrimaryButton';

const SCREEN_WIDTH = Dimensions.get('window').width;

const slides = [
    {
        id: 'overview',
        icon: WalletCards,
        title: 'Your Money.\nClearly.',
        subtitle: 'BanKoni helps you understand where your money goes, one day at a time.',
    },
    {
        id: 'tracking',
        icon: ChartNoAxesCombined,
        title: 'Track Every\nBirr.',
        subtitle: 'Record income and expenses in one simple, private place.',
    },
    {
        id: 'habits',
        icon: Target,
        title: 'Build Better\nHabits.',
        subtitle: 'Set budgets, recognize patterns, and take control of your financial life.',
    },
] as const;

type Props = {
    navigation: StackNavigationProp<AuthStackParamList, 'Onboarding'>;
};

type Slide = (typeof slides)[number];

export default function OnboardingScreen({ navigation }: Props) {
    const colors = useTheme();
    const styles = createStyles(colors);
    const [activeIndex, setActiveIndex] = useState(0);
    const flatListRef = useRef<FlatList<Slide> | null>(null);

    const goToSlide = useCallback((index: number) => {
        const boundedIndex = Math.max(0, Math.min(index, slides.length - 1));
        flatListRef.current?.scrollToIndex({ index: boundedIndex, animated: true });
        setActiveIndex(boundedIndex);
    }, []);

    const handleNext = useCallback(() => {
        if (activeIndex < slides.length - 1) {
            goToSlide(activeIndex + 1);
            return;
        }
        navigation.navigate('Register');
    }, [activeIndex, goToSlide, navigation]);

    const onViewableItemsChanged = useRef(
        ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            const index = viewableItems.find((token) => token.isViewable)?.index;
            if (typeof index === 'number') setActiveIndex(index);
        },
    ).current;

    const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 60 }).current;

    const renderSlide: ListRenderItem<Slide> = ({ item }) => {
        const Icon = item.icon;
        return (
            <View style={styles.slide}>
                <View style={styles.iconHalo}>
                    <Icon size={68} color={colors.champagne} strokeWidth={1.6} />
                </View>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.subtitle}>{item.subtitle}</Text>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <StatusBar style={colors.statusBar} />
            <FlatList
                ref={flatListRef}
                data={slides as unknown as Slide[]}
                renderItem={renderSlide}
                keyExtractor={(item) => item.id}
                horizontal
                pagingEnabled
                bounces={false}
                getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={viewabilityConfig}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.listContent}
            />

            <View style={styles.bottomSection}>
                <View style={styles.dotContainer} accessibilityLabel={`Slide ${activeIndex + 1} of ${slides.length}`}>
                    {slides.map((slide, index) => (
                        <View
                            key={slide.id}
                            style={[styles.dot, index === activeIndex ? styles.dotActive : styles.dotInactive]}
                        />
                    ))}
                </View>

                <PrimaryButton
                    label={activeIndex === slides.length - 1 ? 'Get Started' : 'Next'}
                    onPress={handleNext}
                    style={{ width: Math.min(SCREEN_WIDTH - 56, 420) }}
                />

                {activeIndex < slides.length - 1 ? (
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Skip onboarding"
                        onPress={() => goToSlide(slides.length - 1)}
                        style={styles.skipButton}
                        activeOpacity={0.75}
                    >
                        <Text style={styles.skipText}>Skip</Text>
                    </TouchableOpacity>
                ) : (
                    <View style={styles.skipPlaceholder} />
                )}
            </View>
        </View>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    listContent: {
        flexGrow: 1,
    },
    slide: {
        width: SCREEN_WIDTH,
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 36,
        paddingBottom: 28,
    },
    iconHalo: {
        width: 116,
        height: 116,
        borderRadius: 58,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceAlt,
        borderColor: colors.border,
        borderWidth: 1,
        marginBottom: 32,
    },
    title: {
        fontSize: 38,
        fontWeight: '700',
        color: colors.textPrimary,
        textAlign: 'center',
        lineHeight: 45,
        marginBottom: 18,
    },
    subtitle: {
        maxWidth: 330,
        fontSize: 16,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 25,
    },
    bottomSection: {
        alignItems: 'center',
        paddingHorizontal: 28,
        paddingBottom: 34,
        gap: 16,
    },
    dotContainer: {
        minHeight: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    dot: {
        height: 7,
        borderRadius: 4,
    },
    dotActive: {
        width: 24,
        backgroundColor: colors.champagne,
    },
    dotInactive: {
        width: 7,
        backgroundColor: colors.textSecondary,
        opacity: 0.55,
    },
    skipButton: {
        minHeight: 26,
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    skipText: {
        fontSize: 14,
        color: colors.textSecondary,
    },
    skipPlaceholder: {
        height: 26,
    },
});
