// the centralize theme system for BANKONI
// every svreeen reads form the via the useTheme() hook.
// changging the theme in zustand automaticlayu updates every screen


export interface ThemeColors {
    background: string;     // Page background
    surface: string;        // Card/container background
    surfaceAlt: string;     // Alternate surface (e.g., inputs)
    textPrimary: string;    // Main readable text
    textSecondary: string;  // Labels, muted text
    textMuted: string;      // Placeholders, hints
    champagne: string;      // Brand accent (stays same in both modes)
    subtleGold: string;     // Subtle borders and accents
    success: string;        // Green — income
    danger: string;         // Red — expense
    border: string;         // Default border color
    cardBorder: string;     // Subtle card borders
    overlay: string;        // Modal backdrop
    statusBar: 'light' | 'dark';  // Status bar text color
    cardGlassFrom: string;  // Glass card gradient stop 1
    cardGlassVia: string;   // Glass card gradient stop 2
    cardGlassTo: string;    // Glass card gradient stop 3
    cardChipLine: string;   // Chip line color on the card
    cardGlow: string;       // Glass catch-light / top highlight
    switchTrackOff: string; // Clearly visible switch track when turned off
}

// dark theme our original navy + gold)
export const darkTheme: ThemeColors = {
    background: '#080D18',
    surface: '#121A28',
    surfaceAlt: '#0D1220',
    textPrimary: '#F4F0E6',
    textSecondary: '#8D939E',
    textMuted: '#5A5E66',
    champagne: '#C8A96B',
    subtleGold: '#8F7548',
    success: '#4CAF50',
    danger: '#EF5350',
    border: '#1E2636',
    cardBorder: '#8F754830',
    overlay: 'rgba(0, 0, 0, 0.55)',
    statusBar: 'light',
    cardGlassFrom: 'rgba(16,22,40,0.95)',
    cardGlassVia: 'rgba(8,13,24,0.98)',
    cardGlassTo: 'rgba(5,8,18,1)',
    cardChipLine: 'rgba(0,0,0,0.25)',
    cardGlow: 'rgba(255,255,255,0.04)',
    switchTrackOff: '#283347',
};
// lightmode clenat white + gold
export const lightTheme: ThemeColors = {
    background: '#F8F7F4',
    surface: '#FFFFFF',
    surfaceAlt: '#F0EDE6',
    textPrimary: '#1A1A1A',
    textSecondary: '#6B6B6B',
    textMuted: '#A0A0A0',
    champagne: '#B8943F',       // Slightly darker gold for legibility on white
    subtleGold: '#D4BC7C',
    success: '#2E7D32',
    danger: '#C62828',
    border: '#E8E5DE',
    cardBorder: '#D4BC7C30',
    overlay: 'rgba(0, 0, 0, 0.35)',
    statusBar: 'dark',
    cardGlassFrom: 'rgba(255,255,255,0.85)',
    cardGlassVia: 'rgba(248,246,240,0.92)',
    cardGlassTo: 'rgba(240,236,226,0.95)',
    cardChipLine: 'rgba(255,255,255,0.5)',
    cardGlow: 'rgba(255,255,255,0.6)',
    switchTrackOff: '#D1CAB9',
};