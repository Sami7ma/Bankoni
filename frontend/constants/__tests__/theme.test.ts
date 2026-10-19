import { describe, expect, it } from '@jest/globals';
import { darkTheme, lightTheme } from '../theme';

describe('theme', () => {
    it('dark and light themes define exactly the same keys', () => {
        expect(Object.keys(lightTheme).sort()).toEqual(Object.keys(darkTheme).sort());
    });

    it('every theme value is a non-empty string', () => {
        for (const theme of [darkTheme, lightTheme]) {
            for (const [key, value] of Object.entries(theme)) {
                expect(typeof value).toBe('string');
                expect((value as string).length).toBeGreaterThan(0);
                expect(key).toBeTruthy();
            }
        }
    });
});
