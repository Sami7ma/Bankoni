// A smooht line char that hsows spending over time.
// How it works:-
// parent passes labesl (x-axis) and calues in the y- axis
// this componte srender the card using  react-native-charts-kit.
// so why a separte componte
// chart rendering is complez - colors, gradients, spacing..
// it lets the analytiscs screen focus on the data  not the presentation
// it lets the analystics screen calculate what to show not the chart
import { View, Text, StyleSheet, Dimensions } from "react-native";
import useTheme from "../../../hooks/useTheme";
import { LineChart } from 'react-native-chart-kit';

// Screen width
const SCREEN_WIDTH = Dimensions.get('window').width;

// props
interface SpendingLineChartProps {
    labels: string[];    // x-axis labels like ["Jun", "Jul", "Aug"]
    values: number[];    // data points like [500, 300, 800]
}

// Helper to format Y-axis currency numbers consistently without clutter
const formatYValue = (val: string) => {
    const num = Math.round(Number(val));
    if (isNaN(num)) return val;
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 10000) return `${Math.round(num / 1000)}k`;
    return `${num}`;
};

export default function SpendingLineChart({ labels, values }: SpendingLineChartProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    // empty state
    if (values.length === 0 || values.every((v) => v === 0)) {
        return (
            <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No spending data available</Text>
                <Text style={styles.emptySubtext}>Start by adding a transaction!</Text>
            </View>
        );
    }

    // Dynamic width calculation so the curve extends cleanly to the right side of the card,
    // eliminating dead space, while paddingLeftOffset gives generous room on the left
    // so "ETB" labels never touch or crowd the left card border.
    const numPoints = Math.max(labels.length, 1);
    const cardInnerWidth = SCREEN_WIDTH - 20; // 10px padding on screen edges
    const paddingLeftOffset = 90; // Left margin for Y-axis labels (keeps ETB 30px away from border)
    const targetRight = cardInnerWidth - 28; // Where the last point should land
    const chartWidth = numPoints > 1
        ? paddingLeftOffset + (targetRight - paddingLeftOffset) * (numPoints / (numPoints - 1))
        : cardInnerWidth;

    return (
        <View style={styles.container}>
            <LineChart
                data={{
                    labels: labels,
                    datasets: [{ data: values }],
                }}
                width={chartWidth}
                height={210}
                yAxisLabel="ETB "
                yAxisSuffix=""
                yLabelsOffset={8}
                formatYLabel={formatYValue}
                withDots={true}              // show dots on data points
                withInnerLines={false}       // hide horizontal grid lines
                withOuterLines={false}       // hide the outer border
                withVerticalLines={false}    // hide vertical grid lines
                withHorizontalLabels={true}  // show y-axis labels
                fromZero={true}              // y-axis starts at 0
                bezier                       // smooth curved line (not jagged)
                chartConfig={{
                    // BACKGROUND
                    backgroundColor: colors.surface,
                    backgroundGradientFrom: colors.surface,
                    backgroundGradientTo: colors.surface,
                    decimalPlaces: 0,
                    // LINE + DOTS
                    color: () => colors.champagne,           // line color (gold)
                    // FILL UNDER THE LINE
                    fillShadowGradientFrom: colors.champagne,
                    fillShadowGradientFromOpacity: 0.3,      // semi-transparent
                    fillShadowGradientTo: colors.champagne,
                    fillShadowGradientToOpacity: 0.0,        // fades to invisible
                    // LABELS (text on axes)
                    labelColor: () => colors.textPrimary,
                    propsForLabels: {
                        fontSize: 12,
                        fontWeight: '700',
                    },
                    // DECORATION
                    propsForDots: {
                        r: '4',                               // dot radius
                        strokeWidth: '2',
                        stroke: colors.champagne,
                    },
                }}
                style={styles.chart}
            />
        </View>
    );
}

// styles
const createStyles = (colors: ReturnType<typeof useTheme>) => StyleSheet.create({
    container: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        paddingTop: 16,
        paddingBottom: 14,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        alignItems: 'flex-start',
    },
    chart: {
        borderRadius: 12,
        paddingRight: 90, // Sets react-native-chart-kit left plot offset
    },
    emptyContainer: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 32,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        gap: 8,
    },
    emptyText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    emptySubtext: {
        fontSize: 14,
        color: colors.textSecondary,
        textAlign: 'center',
    },
})
