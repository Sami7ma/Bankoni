// utils/recurringCommitments.ts
//
// Recurring payments and commitment recognition engine.
// Analyzes transaction intervals, amounts, and merchant types to identify
// subscriptions, utilities, rent, education fees, and telecom packages.
// Preserves distinctions between observed patterns and confirmed commitments.

import type { Transaction } from '../types/Transaction';
import type {
    RecurringCommitment,
    CommitmentType,
    CommitmentFrequency,
} from '../types/FinancialRelationships';
import { getDaysInclusive, getEthiopianDateString } from './date';

export interface DetectedRecurringPattern {
    name: string;
    commitmentType: CommitmentType;
    categoryId: string;
    expectedAmount?: number;
    isVariableAmount: boolean;
    frequency: CommitmentFrequency;
    billingDay?: number;
    confidence: 'high' | 'medium' | 'low';
    observedCount: number;
    transactionIds: string[];
    nextExpectedDate?: string;
}

/**
 * Checks if a collection of interval day deltas matches a recurring frequency.
 */
function evaluateFrequencyFromDeltas(deltas: number[]): {
    frequency?: CommitmentFrequency;
    isVariable: boolean;
} {
    if (deltas.length === 0) return { isVariable: false };

    const avg = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;

    // Daily: 1 day interval (avg between 0.8 and 1.5)
    if (avg >= 0.8 && avg <= 1.5) {
        return { frequency: 'daily', isVariable: false };
    }

    // Weekly: 7 days (+/- 2 days)
    if (avg >= 5 && avg <= 9) {
        return { frequency: 'weekly', isVariable: false };
    }

    // Bi-weekly: 14 days (+/- 3 days)
    if (avg >= 12 && avg <= 16) {
        return { frequency: 'biweekly', isVariable: false };
    }

    // Monthly: 28 to 32 days (calendar month)
    if (avg >= 26 && avg <= 35) {
        return { frequency: 'monthly', isVariable: false };
    }

    // Semester: ~120 to 180 days (4 to 6 months)
    if (avg >= 110 && avg <= 190) {
        return { frequency: 'semester', isVariable: true };
    }

    // Yearly: 350 to 380 days
    if (avg >= 340 && avg <= 390) {
        return { frequency: 'yearly', isVariable: false };
    }

    return { isVariable: true };
}

/**
 * Infers commitment type from category or name keywords.
 */
function inferCommitmentType(name: string, categoryId: string): CommitmentType {
    const lower = name.toLowerCase();

    if (/\b(?:school|college|university|academy|tuition)\b/i.test(lower)) {
        return 'education';
    }
    if (/\b(?:rent|landlord|house)\b/i.test(lower) || categoryId === 'cat-10') {
        return 'rent';
    }
    if (/\b(?:electric|water|utility|bill|eeu|aawsa)\b/i.test(lower) || categoryId === 'cat-11') {
        return 'utility';
    }
    if (/\b(?:telecom|internet|package|bundle|data)\b/i.test(lower) || categoryId === 'cat-6') {
        return 'telecom';
    }
    if (/\b(?:subscription|netflix|spotify|gym|club)\b/i.test(lower) || categoryId === 'cat-8') {
        return 'subscription';
    }

    return 'other';
}

/**
 * Detects repeated payment patterns from cleared debit transactions.
 * Requires at least 2 observed occurrences at consistent intervals.
 * Does NOT classify a single purchase as a confirmed recurring commitment!
 */
export function detectRecurringPatterns(
    transactions: Transaction[]
): DetectedRecurringPattern[] {
    // Group cleared debits by counterparty, note, or category
    const grouped: Record<string, Transaction[]> = {};

    for (const tx of transactions) {
        if (tx.type !== 'DEBIT' || tx.status !== 'CLEARED' || tx.isTransfer) continue;

        const key = tx.counterparty?.trim() || tx.note?.trim() || tx.categoryId;
        if (!key) continue;

        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(tx);
    }

    const patterns: DetectedRecurringPattern[] = [];

    for (const [key, txList] of Object.entries(grouped)) {
        // Must have at least 2 transactions to establish repetition
        if (txList.length < 2) continue;

        // Sort chronologically ascending
        const sorted = [...txList].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        // Compute consecutive day intervals
        const deltas: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
            const dateA = getEthiopianDateString(sorted[i - 1].date);
            const dateB = getEthiopianDateString(sorted[i].date);
            const days = getDaysInclusive(dateA, dateB) - 1;
            deltas.push(days);
        }

        const { frequency } = evaluateFrequencyFromDeltas(deltas);
        if (!frequency) continue;

        // Check amount variation
        const amounts = sorted.map((t) => t.amount);
        const minAmount = Math.min(...amounts);
        const maxAmount = Math.max(...amounts);
        const isVariableAmount = maxAmount - minAmount > 1.0;
        const avgAmount = Number((amounts.reduce((sum, a) => sum + a, 0) / amounts.length).toFixed(2));

        const lastTx = sorted[sorted.length - 1];
        const lastDate = new Date(lastTx.date);
        const billingDay = lastDate.getUTCDate();

        // Calculate next expected date
        const nextDate = new Date(lastDate);
        if (frequency === 'daily') nextDate.setUTCDate(nextDate.getUTCDate() + 1);
        else if (frequency === 'weekly') nextDate.setUTCDate(nextDate.getUTCDate() + 7);
        else if (frequency === 'biweekly') nextDate.setUTCDate(nextDate.getUTCDate() + 14);
        else if (frequency === 'monthly') nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
        else if (frequency === 'semester') nextDate.setUTCMonth(nextDate.getUTCMonth() + 4);
        else if (frequency === 'yearly') nextDate.setUTCFullYear(nextDate.getUTCFullYear() + 1);

        const commitmentType = inferCommitmentType(key, lastTx.categoryId);
        const confidence = txList.length >= 3 ? 'high' : 'medium';

        patterns.push({
            name: key,
            commitmentType,
            categoryId: lastTx.categoryId,
            expectedAmount: isVariableAmount ? undefined : avgAmount,
            isVariableAmount,
            frequency,
            billingDay,
            confidence,
            observedCount: txList.length,
            transactionIds: sorted.map((t) => t.id),
            nextExpectedDate: nextDate.toISOString().slice(0, 10),
        });
    }

    return patterns;
}
