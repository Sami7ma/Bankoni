import { describe, expect, it } from '@jest/globals';
import { formatEtb } from '../format';

describe('formatEtb', () => {
    it('formats integer amounts with two decimal places and commas', () => {
        expect(formatEtb(0)).toBe('ETB 0.00');
        expect(formatEtb(1500)).toBe('ETB 1,500.00');
        expect(formatEtb(1234567)).toBe('ETB 1,234,567.00');
    });

    it('formats fractional amounts rounded to two decimal places', () => {
        expect(formatEtb(42.5)).toBe('ETB 42.50');
        expect(formatEtb(99.99)).toBe('ETB 99.99');
        expect(formatEtb(10.001)).toBe('ETB 10.00');
    });

    it('formats negative amounts with standard international prefix (-ETB)', () => {
        expect(formatEtb(-1500)).toBe('-ETB 1,500.00');
        expect(formatEtb(-0.5)).toBe('-ETB 0.50');
        expect(formatEtb(-42.5)).toBe('-ETB 42.50');
    });

    it('suppresses negative zero for -0 and values rounding to zero', () => {
        expect(formatEtb(-0)).toBe('ETB 0.00');
        expect(formatEtb(-0.001)).toBe('ETB 0.00');
        expect(formatEtb(-0.0049)).toBe('ETB 0.00');
        expect(formatEtb(-0.005)).toBe('-ETB 0.01');
    });

    it('applies Math.abs when abs is true (BalanceCards, BudgetCard magnitudes)', () => {
        expect(formatEtb(-1500, { abs: true })).toBe('ETB 1,500.00');
        expect(formatEtb(1500, { abs: true })).toBe('ETB 1,500.00');
        expect(formatEtb(-0, { abs: true })).toBe('ETB 0.00');
    });

    it('supports custom decimal precision for whole-birr displays', () => {
        expect(formatEtb(1500, { decimals: 0 })).toBe('ETB 1,500');
        expect(formatEtb(-500, { decimals: 0 })).toBe('-ETB 500');
        expect(formatEtb(0, { decimals: 0 })).toBe('ETB 0');
        expect(formatEtb(-0.4, { decimals: 0 })).toBe('ETB 0');
        expect(formatEtb(-0.6, { decimals: 0 })).toBe('-ETB 1');
    });
});
