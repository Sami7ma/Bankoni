// components/common/CategoryPicker.tsx
//
// A dropdown category selector with an expandable list.
// WHERE IT'S USED:
// - AddTransactionModal (pick expense or income category)
// - AddBudgetModal (pick expense category for budget)
//
// WHY A COMPONENT?
// The category dropdown is ~60 lines of JSX duplicated in both modals.
// Extracting it saves ~120 lines total and ensures both modals
// have the exact same selection experience.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { ChevronDown, Check, Plus } from 'lucide-react-native';
import useTheme from '../../../hooks/useTheme';
import type { Category, CategoryFlow } from '../../../types/Category';
import CategoryIcon from '../icons/CategoryIcon';
import AddCategoryModal from '../../modals/AddCategoryModal';

interface CategoryPickerProps {
    categories: Category[];        // the list of categories to display
    selectedId: string;            // currently selected category ID
    onSelect: (id: string) => void;  // called when user picks a category
    placeholder?: string;          // text shown when nothing is selected
    label?: string;                // field label (defaults to "Category")
    flow?: CategoryFlow;           // optional flow for custom category modal
}

export default function CategoryPicker({
    categories,
    selectedId,
    onSelect,
    placeholder = 'Select a category',
    label = 'Category',
    flow = 'EXPENSE',
}: CategoryPickerProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    // Internal state — controls whether the dropdown list is visible.
    const [isOpen, setIsOpen] = useState(false);
    const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);

    // Find the full category object from the selected ID
    const selectedCategory = categories.find((cat) => cat.id === selectedId);

    return (
        <View style={styles.container}>
            {/* Label */}
            <Text style={styles.label}>{label}</Text>

            {/* Selector button — shows current selection or placeholder */}
            <TouchableOpacity
                activeOpacity={0.8}
                style={styles.selectorButton}
                onPress={() => setIsOpen(!isOpen)}
            >
                <View style={styles.selectorLeft}>
                    {selectedCategory && (
                        <View
                            style={[
                                styles.iconBadge,
                                {
                                    backgroundColor: selectedCategory.colorKey
                                        ? `${selectedCategory.colorKey}20`
                                        : `${colors.champagne}20`,
                                    borderColor: selectedCategory.colorKey ?? colors.champagne,
                                },
                            ]}
                        >
                            <CategoryIcon
                                iconKey={selectedCategory.iconKey}
                                color={selectedCategory.colorKey ?? colors.champagne}
                                size={15}
                                flow={selectedCategory.flow}
                            />
                        </View>
                    )}
                    <Text
                        style={[
                            styles.selectorText,
                            // Gray text when nothing is selected
                            !selectedCategory && { color: colors.textMuted },
                        ]}
                    >
                        {selectedCategory?.name ?? placeholder}
                    </Text>
                </View>

                <ChevronDown size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            {/* Expandable category list — only visible when isOpen */}
            {isOpen && (
                <View style={styles.list}>
                    <ScrollView
                        nestedScrollEnabled    // allows scrolling inside a ScrollView parent
                        showsVerticalScrollIndicator={false}
                    >
                        {/* + Add Custom Category item */}
                        <TouchableOpacity
                            activeOpacity={0.7}
                            style={styles.addCategoryItem}
                            onPress={() => {
                                setIsOpen(false);
                                setIsAddCategoryOpen(true);
                            }}
                        >
                            <View style={styles.addCategoryLeft}>
                                <View style={styles.addPlusCircle}>
                                    <Plus size={15} color={colors.champagne} />
                                </View>
                                <Text style={styles.addCategoryText}>+ Create New Category</Text>
                            </View>
                        </TouchableOpacity>

                        {categories.length === 0 ? (
                            <Text style={styles.emptyText}>
                                No categories available
                            </Text>
                        ) : (
                            categories.map((category) => {
                                const isSelected = category.id === selectedId;
                                return (
                                    <TouchableOpacity
                                        key={category.id}
                                        activeOpacity={0.7}
                                        style={[
                                            styles.item,
                                            // Gold tint background when selected
                                            isSelected && {
                                                backgroundColor: colors.champagne + '12',
                                            },
                                        ]}
                                        onPress={() => {
                                            onSelect(category.id);
                                            setIsOpen(false); // close dropdown after selection
                                        }}
                                    >
                                        <View style={styles.itemLeft}>
                                            <View
                                                style={[
                                                    styles.itemIconBadge,
                                                    {
                                                        backgroundColor: category.colorKey
                                                            ? `${category.colorKey}20`
                                                            : `${colors.champagne}15`,
                                                        borderColor: category.colorKey ?? `${colors.champagne}40`,
                                                    },
                                                ]}
                                            >
                                                <CategoryIcon
                                                    iconKey={category.iconKey}
                                                    color={category.colorKey ?? colors.champagne}
                                                    size={15}
                                                    flow={category.flow}
                                                />
                                            </View>
                                            <Text
                                                style={[
                                                    styles.itemText,
                                                    // Gold text when selected
                                                    isSelected && {
                                                        color: colors.champagne,
                                                        fontWeight: '700',
                                                    },
                                                ]}
                                            >
                                                {category.name}
                                            </Text>
                                            {category.isCustom && (
                                                <View style={styles.customBadge}>
                                                    <Text style={styles.customBadgeText}>CUSTOM</Text>
                                                </View>
                                            )}
                                        </View>

                                        {/* Checkmark icon — only on the selected item */}
                                        {isSelected && (
                                            <Check size={17} color={colors.champagne} />
                                        )}
                                    </TouchableOpacity>
                                );
                            })
                        )}
                    </ScrollView>
                </View>
            )}

            {/* Custom Category Modal */}
            <AddCategoryModal
                visible={isAddCategoryOpen}
                defaultFlow={flow}
                onClose={() => setIsAddCategoryOpen(false)}
                onCategoryCreated={(newCat) => {
                    onSelect(newCat.id);
                }}
            />
        </View>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        container: {
            gap: 8,
        },
        label: {
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 1,
            color: colors.textSecondary,
            textTransform: 'uppercase',
        },
        selectorButton: {
            minHeight: 50,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 15,
            borderRadius: 14,
            borderWidth: 1,
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
        },
        selectorLeft: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            flex: 1,
        },
        iconBadge: {
            width: 28,
            height: 28,
            borderRadius: 8,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
        },
        itemIconBadge: {
            width: 30,
            height: 30,
            borderRadius: 9,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
        },
        selectorText: {
            fontSize: 15,
            fontWeight: '500',
            color: colors.textPrimary,
        },
        list: {
            maxHeight: 220,
            marginTop: 6,
            borderRadius: 14,
            borderWidth: 1,
            overflow: 'hidden',
            backgroundColor: colors.surface,
            borderColor: colors.border,
        },
        addCategoryItem: {
            minHeight: 46,
            paddingHorizontal: 15,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: `${colors.champagne}10`,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        addCategoryLeft: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
        },
        addPlusCircle: {
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: `${colors.champagne}20`,
            alignItems: 'center',
            justifyContent: 'center',
        },
        addCategoryText: {
            fontSize: 13,
            fontWeight: '700',
            color: colors.champagne,
            letterSpacing: 0.3,
        },
        item: {
            minHeight: 48,
            paddingHorizontal: 15,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        itemLeft: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            flex: 1,
        },
        itemText: {
            fontSize: 14,
            fontWeight: '500',
            color: colors.textPrimary,
        },
        customBadge: {
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: 6,
            backgroundColor: `${colors.champagne}18`,
        },
        customBadgeText: {
            fontSize: 9,
            fontWeight: '700',
            color: colors.champagne,
            letterSpacing: 0.5,
        },
        emptyText: {
            padding: 16,
            fontSize: 14,
            color: colors.textSecondary,
            textAlign: 'center',
        },
    });
