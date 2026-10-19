import { describe, expect, it } from '@jest/globals';
import { alpha, radii } from '../designTokens';
import { darkTheme, lightTheme } from '../theme';

describe('designTokens', () => {
    it('keeps the exact literals the modal shell used before the refactor', () => {
        expect(alpha).toEqual({ modalSurface: 'F2', modalBorder: '55', modalHighlight: '18' });
        expect(radii.modal).toBe(30);
    });

    it('alpha tokens are two hex digits', () => {
        for (const value of Object.values(alpha)) {
            expect(value).toMatch(/^[0-9A-Fa-f]{2}$/);
        }
    });

    it('theme colors that receive an alpha suffix are 7-char #RRGGBB (so the result is valid #RRGGBBAA)', () => {
        for (const theme of [darkTheme, lightTheme]) {
            for (const color of [theme.surface, theme.champagne]) {
                expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
                for (const a of Object.values(alpha)) {
                    expect(color + a).toMatch(/^#[0-9A-Fa-f]{8}$/);
                }
            }
        }
    });

    it('resolves the same card colors as the old inline concatenations', () => {
        expect(darkTheme.surface + alpha.modalSurface).toBe('#121A28F2');
        expect(darkTheme.champagne + alpha.modalBorder).toBe('#C8A96B55');
        expect(lightTheme.champagne + alpha.modalHighlight).toBe('#B8943F18');
    });
});
