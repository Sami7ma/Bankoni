// Shared, theme-independent design values.
//
// Colors live in constants/theme.ts (they differ between light and dark).
// This file only holds values that are identical in both themes and are
// genuinely reused by several components. Each token documents the exact
// literal it replaced so nothing visually changes.

/**
 * Two-digit hex alpha suffixes. Append them to a 7-character "#RRGGBB" theme
 * color, e.g. `colors.surface + alpha.modalSurface`. The result is an 8-digit
 * "#RRGGBBAA" color.
 */
export const alpha = {
    /** Floating modal card background (was the literal 'F2'). */
    modalSurface: 'F2',
    /** Floating modal card gold outline (was the literal '55'). */
    modalBorder: '55',
    /** Inner "glass" highlight ring inside a modal card (was the literal '18'). */
    modalHighlight: '18',
} as const;

/** Corner radii shared by several components. */
export const radii = {
    /** Floating modal card and its inner highlight ring (was the literal 30). */
    modal: 30,
} as const;
