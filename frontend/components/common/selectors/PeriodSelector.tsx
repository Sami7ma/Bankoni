// components/common/PeriodSelector.tsx
// Date range selector with a built-in period wheel picker.
//
// HOW IT WORKS:
// 1. Shows a period wheel (Daily / Weekly / Biweekly / Monthly)
//    with a "Custom" button next to it
// 2. When a preset period is scrolled to, dates auto-fill
//    (e.g. Monthly → 1st to last of current month)
// 3. When "Custom" is tapped, a calendar appears where
//    the user manually picks start and end dates
// 4. A date summary always shows the selected range
//
// WHERE IT'S USED:
// - AddBudgetModal (pick budget period)
// - Could be reused for recurring transactions later
//
// WHY A COMPONENT?
// This was 400+ lines inside AddBudgetModal.
// Extracting it keeps the modal focused on its job
// (collecting budget data) instead of managing date logic.

import { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, } from 'react-native';
import { Calendar as CalendarIcon } from 'lucide-react-native';
import { Calendar } from 'react-native-calendars';
import useTheme from '../../../hooks/useTheme';

//  TYPES
// These define what kind of period the user can pick
type FixedPeriod = 'daily' | 'weekly' | 'biweekly' | 'monthly';
type BudgetPeriod = FixedPeriod | 'custom';

//PRESET OPTIONS for the scroll wheel
const PERIOD_OPTIONS: { value: FixedPeriod; label: string }[] = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Biweekly' },
    { value: 'monthly', label: 'Monthly' },
];

//  PROPS 
// The parent (AddBudgetModal) controls the dates and period.
// This component just provides the UI for changing them.
interface PeriodSelectorProps {
    startDate: string;                          // YYYY-MM-DD
    endDate: string;                            // YYYY-MM-DD
    period: BudgetPeriod;                       // current selection
    onStartDateChange: (date: string) => void;  // update start
    onEndDateChange: (date: string) => void;    // update end
    onPeriodChange: (period: BudgetPeriod) => void;  // update period type
}

//  HELPER: format YYYY-MM-DD → "Aug 24, 2026" 
const formatDate = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });

//  HELPER: Date object → YYYY-MM-DD string 
const toDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

//  DATE RANGE CALCULATORS 
// Each returns { start, end } for the given period type

const getDailyRange = () => {
    const today = toDateString(new Date());
    return { start: today, end: today };
};

const getWeeklyRange = () => {
    const today = new Date();
    const day = today.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysFromMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: toDateString(monday), end: toDateString(sunday) };
};

const getBiweeklyRange = () => {
    const today = new Date();
    const day = today.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    const start = new Date(today);
    start.setDate(today.getDate() - daysFromMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 13);
    return { start: toDateString(start), end: toDateString(end) };
};

const getMonthlyRange = () => {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: toDateString(first), end: toDateString(last) };
};

const getRangeForPeriod = (p: FixedPeriod) => {
    if (p === 'daily') return getDailyRange();
    if (p === 'weekly') return getWeeklyRange();
    if (p === 'biweekly') return getBiweeklyRange();
    return getMonthlyRange();
};

//  HELPER: get all dates between start and end 
// Used to highlight the range on the calendar
const getDatesBetween = (start: string, end: string) => {
    const dates: string[] = [];
    const current = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    while (current <= last) {
        dates.push(toDateString(current));
        current.setDate(current.getDate() + 1);
    }
    return dates;
};

// ══════════════════════════════════════════════════════════
// PERIOD WHEEL — the scrollable iOS-style picker

function PeriodWheel({
    value,
    onChange,
}: {
    value: FixedPeriod;
    onChange: (v: FixedPeriod) => void;
}) {
    const colors = useTheme();
    const styles = createStyles(colors);
    const ITEM_HEIGHT = 42;
    const listRef = useRef<FlatList>(null);

    const selectedIndex = PERIOD_OPTIONS.findIndex(
        (item) => item.value === value
    );

    // When scrolling stops, figure out which item is centered
    const handleScrollEnd = (event: any) => {
        const offsetY = event.nativeEvent.contentOffset.y;
        const index = Math.round(offsetY / ITEM_HEIGHT);
        const selected = PERIOD_OPTIONS[index];
        if (selected) onChange(selected.value);
    };

    return (
        <View style={styles.wheelContainer}>
            <FlatList
                ref={listRef}
                data={PERIOD_OPTIONS}
                keyExtractor={(item) => item.value}
                showsVerticalScrollIndicator={false}
                snapToInterval={ITEM_HEIGHT}     // snaps to each item
                decelerationRate="fast"          // stops quickly after flick
                bounces={false}
                getItemLayout={(_, index) => ({
                    length: ITEM_HEIGHT,
                    offset: ITEM_HEIGHT * index,
                    index,
                })}
                contentContainerStyle={{ paddingVertical: ITEM_HEIGHT }}
                initialScrollIndex={selectedIndex >= 0 ? selectedIndex : 0}
                onMomentumScrollEnd={handleScrollEnd}
                renderItem={({ item }) => {
                    const isActive = item.value === value;
                    return (
                        <View style={[styles.wheelItem, { height: ITEM_HEIGHT }]}>
                            <Text
                                style={[
                                    styles.wheelText,
                                    isActive && styles.wheelTextActive,
                                ]}
                            >
                                {item.label}
                            </Text>
                        </View>
                    );
                }}
            />
            {/* Selection highlight bar — sits behind the center item */}
            <View pointerEvents="none" style={styles.wheelHighlight} />
        </View>
    );
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function PeriodSelector({
    startDate,
    endDate,
    period,
    onStartDateChange,
    onEndDateChange,
    onPeriodChange,
}: PeriodSelectorProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    // Internal state — which date field is being picked
    const [selectingDate, setSelectingDate] = useState<'start' | 'end'>('start');
    const [showCalendar, setShowCalendar] = useState(false);

    //  HANDLE PERIOD CHANGE 
    const handlePeriodChange = (newPeriod: BudgetPeriod) => {
        onPeriodChange(newPeriod);

        if (newPeriod === 'custom') {
            const today = toDateString(new Date());
            onStartDateChange(today);
            onEndDateChange(today);
            setSelectingDate('start');
            setShowCalendar(true);
            return;
        }

        const range = getRangeForPeriod(newPeriod);
        onStartDateChange(range.start);
        onEndDateChange(range.end);
        setShowCalendar(false);
    };

    //  CALENDAR DATE SELECTION 
    const handleDateSelect = (date: string) => {
        if (selectingDate === 'start') {
            onStartDateChange(date);
            setSelectingDate('end');
            return;
        }
        if (date < startDate) {
            alert('End date cannot be before the start date');
            return;
        }
        onEndDateChange(date);
        setShowCalendar(false);
    };

    //  CALENDAR MARKINGS 
    // Build the marked dates object for react-native-calendars
    const rangeDates = getDatesBetween(startDate, endDate);
    const markedDates = rangeDates.reduce(
        (marks, date) => {
            marks[date] = {
                startingDay: date === startDate,
                endingDay: date === endDate,
                color: colors.champagne,
                textColor: colors.background,
            };
            return marks;
        },
        {} as Record<string, any>
    );

    //  UI 
    return (
        <>
            {/* PERIOD PICKER — wheel + custom button */}
            <View style={styles.fieldGroup}>
                <Text style={styles.label}>Period</Text>
                <View style={styles.periodRow}>
                    <PeriodWheel
                        value={period === 'custom' ? 'monthly' : period}
                        onChange={handlePeriodChange}
                    />
                    <TouchableOpacity
                        style={[
                            styles.customButton,
                            period === 'custom' && styles.customButtonActive,
                        ]}
                        onPress={() => handlePeriodChange('custom')}
                        activeOpacity={0.8}
                    >
                        <CalendarIcon
                            size={20}
                            color={
                                period === 'custom'
                                    ? colors.background
                                    : colors.champagne
                            }
                        />
                        <Text
                            style={[
                                styles.customText,
                                period === 'custom' && styles.customTextActive,
                            ]}
                        >
                            Custom
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* DATE SUMMARY — always visible */}
            <View style={styles.fieldGroup}>
                <Text style={styles.label}>Budget Period</Text>
                <View style={styles.dateSummary}>
                    <CalendarIcon size={19} color={colors.champagne} />
                    <View style={styles.dateInfo}>
                        <Text style={styles.dateTitle}>
                            {period === 'custom'
                                ? selectingDate === 'start'
                                    ? 'Select start date'
                                    : 'Select end date'
                                : `${period.charAt(0).toUpperCase() + period.slice(1)} budget`}
                        </Text>
                        <Text style={styles.dateRange}>
                            {formatDate(startDate)}
                            {'  →  '}
                            {formatDate(endDate)}
                        </Text>
                    </View>
                </View>

                {/* CUSTOM CALENDAR — only when custom is selected */}
                {period === 'custom' && (
                    <>
                        {/* Start / End selector tabs */}
                        <View style={styles.rangeSelector}>
                            <TouchableOpacity
                                style={styles.rangeField}
                                onPress={() => {
                                    setSelectingDate('start');
                                    setShowCalendar(true);
                                }}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.rangeLabel}>Start</Text>
                                <Text
                                    style={[
                                        styles.rangeDate,
                                        selectingDate === 'start' && styles.rangeDateActive,
                                    ]}
                                >
                                    {formatDate(startDate)}
                                </Text>
                                {selectingDate === 'start' && (
                                    <View style={styles.activeIndicator} />
                                )}
                            </TouchableOpacity>

                            <View style={styles.rangeDivider}>
                                <Text style={styles.rangeArrow}>→</Text>
                            </View>

                            <TouchableOpacity
                                style={styles.rangeField}
                                onPress={() => {
                                    setSelectingDate('end');
                                    setShowCalendar(true);
                                }}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.rangeLabel}>End</Text>
                                <Text
                                    style={[
                                        styles.rangeDate,
                                        selectingDate === 'end' && styles.rangeDateActive,
                                    ]}
                                >
                                    {formatDate(endDate)}
                                </Text>
                                {selectingDate === 'end' && (
                                    <View style={styles.activeIndicator} />
                                )}
                            </TouchableOpacity>
                        </View>

                        {/* Calendar */}
                        {showCalendar && (
                            <View style={styles.calendarContainer}>
                                <Calendar
                                    current={
                                        selectingDate === 'start' ? startDate : endDate
                                    }
                                    minDate={
                                        selectingDate === 'end' ? startDate : undefined
                                    }
                                    onDayPress={(day) =>
                                        handleDateSelect(day.dateString)
                                    }
                                    markedDates={markedDates}
                                    markingType="period"
                                    theme={{
                                        backgroundColor: colors.surface,
                                        calendarBackground: colors.surface,
                                        textSectionTitleColor: colors.textSecondary,
                                        selectedDayBackgroundColor: colors.champagne,
                                        selectedDayTextColor: colors.background,
                                        todayTextColor: colors.champagne,
                                        dayTextColor: colors.textPrimary,
                                        textDisabledColor: colors.textMuted,
                                        monthTextColor: colors.textPrimary,
                                        arrowColor: colors.champagne,
                                        textDayFontWeight: '500',
                                        textMonthFontWeight: '700',
                                        textDayHeaderFontWeight: '600',
                                    }}
                                />
                            </View>
                        )}
                    </>
                )}
            </View>
        </>
    );
}

// ══════════════════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════════════════
const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        fieldGroup: {
            gap: 6,
        },
        label: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
        },

        //  PERIOD ROW (wheel + custom button) 
        periodRow: {
            flexDirection: 'row',
            gap: 10,
            height: 126,
        },

        //  SCROLL WHEEL 
        wheelContainer: {
            flex: 1,
            height: 126,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: colors.surfaceAlt,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
        },
        wheelItem: {
            alignItems: 'center',
            justifyContent: 'center',
        },
        wheelText: {
            fontSize: 15,
            fontWeight: '500',
            color: colors.textMuted,
        },
        wheelTextActive: {
            fontSize: 17,
            fontWeight: '700',
            color: colors.champagne,
        },
        wheelHighlight: {
            position: 'absolute',
            left: 8,
            right: 8,
            top: 42,
            height: 42,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: colors.champagne + '55',
            backgroundColor: colors.champagne + '08',
            borderRadius: 10,
        },

        //  CUSTOM BUTTON 
        customButton: {
            width: '28%',
            minWidth: 90,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
        },
        customButtonActive: {
            backgroundColor: colors.champagne,
            borderColor: colors.champagne,
        },
        customText: {
            fontSize: 13,
            fontWeight: '600',
            color: colors.textSecondary,
        },
        customTextActive: {
            color: colors.background,
        },

        //  DATE SUMMARY 
        dateSummary: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surfaceAlt,
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 12,
        },
        dateInfo: {
            flex: 1,
            gap: 3,
        },
        dateTitle: {
            fontSize: 13,
            fontWeight: '600',
            color: colors.textSecondary,
        },
        dateRange: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.textPrimary,
        },

        //  RANGE SELECTOR (start / end tabs) 
        rangeSelector: {
            flexDirection: 'row',
            alignItems: 'stretch',
            backgroundColor: colors.surfaceAlt,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
        },
        rangeField: {
            flex: 1,
            height: 55,
            paddingHorizontal: 10,
            paddingVertical: 5,
            justifyContent: 'center',
            position: 'relative',
        },
        rangeLabel: {
            fontSize: 11,
            fontWeight: '500',
            letterSpacing: 1,
            color: colors.textMuted,
        },
        rangeDate: {
            fontSize: 16,
            fontWeight: '700',
            color: colors.textPrimary,
        },
        rangeDateActive: {
            color: colors.champagne,
        },
        rangeDivider: {
            width: 32,
            alignItems: 'center',
            justifyContent: 'center',
        },
        rangeArrow: {
            fontSize: 17,
            color: colors.textMuted,
        },
        activeIndicator: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            backgroundColor: colors.champagne,
        },

        //  CALENDAR 
        calendarContainer: {
            backgroundColor: colors.surface,
            borderRadius: 16,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: colors.border,
            marginTop: 10,
        },
    });
