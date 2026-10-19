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

    it('preserves negative amounts when abs is false or omitted (Variant B: TransactionRow)', () => {
        expect(formatEtb(-1500)).toBe('ETB -1,500.00');
        expect(formatEtb(-0.5)).toBe('ETB -0.50');
    });

    it('applies Math.abs when abs is true (Variant A: BalanceCards, BudgetCard)', () => {
        expect(formatEtb(-1500, { abs: true })).toBe('ETB 1,500.00');
        expect(formatEtb(1500, { abs: true })).toBe('ETB 1,500.00');
        expect(formatEtb(-0, { abs: true })).toBe('ETB 0.00');
    });
});
