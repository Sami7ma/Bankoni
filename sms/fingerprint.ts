// sms/fingerprint.ts
// Deterministic duplicate fingerprint generator for SMS transactions.
// Pure TypeScript implementation with zero external runtime dependencies.
// Works seamlessly in Jest (CJS), React Native Hermes/JSC, and Node.

import type { ParsedTransactionCandidate } from './types';

// Standard SHA-256 implementation in pure TypeScript for hermetic determinism
function sha256Hex(ascii: string): string {
    function rightRotate(value: number, amount: number) {
        return (value >>> amount) | (value << (32 - amount));
    }

    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let i: number, j: number;
    let result = '';

    const words: number[] = [];
    const asciiBitLength = ascii.length * 8;

    const hash: number[] = [];
    const k: number[] = [];
    let primeCounter = 0;

    const isPrime = (n: number) => {
        for (let factor = 2, max = Math.sqrt(n); factor <= max; factor++) {
            if (n % factor === 0) return false;
        }
        return true;
    };

    for (let candidate = 2; primeCounter < 64; candidate++) {
        if (isPrime(candidate)) {
            if (primeCounter < 8) {
                hash[primeCounter] = (mathPow(candidate, 1 / 2) * maxWord) | 0;
            }
            k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
            primeCounter++;
        }
    }

    words[asciiBitLength >> 5] |= 0x80 << (24 - (asciiBitLength % 32));
    words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

    for (i = 0; i < ascii.length; i++) {
        words[i >> 2] |= ascii.charCodeAt(i) << (24 - (i % 4) * 8);
    }

    for (let chunk = 0; chunk < words.length; chunk += 16) {
        const w = words.slice(chunk, chunk + 16);
        const oldHash = hash.slice(0);

        for (i = 16; i < 64; i++) {
            const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }

        let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
        let e = hash[4], f = hash[5], g = hash[6], h = hash[7];

        for (i = 0; i < 64; i++) {
            const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + k[i] + (w[i] | 0)) | 0;
            const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) | 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) | 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) | 0;
        }

        hash[0] = (hash[0] + a) | 0;
        hash[1] = (hash[1] + b) | 0;
        hash[2] = (hash[2] + c) | 0;
        hash[3] = (hash[3] + d) | 0;
        hash[4] = (hash[4] + e) | 0;
        hash[5] = (hash[5] + f) | 0;
        hash[6] = (hash[6] + g) | 0;
        hash[7] = (hash[7] + h) | 0;
    }

    for (i = 0; i < 8; i++) {
        for (j = 3; j >= 0; j--) {
            const b = (hash[i] >> (j * 8)) & 255;
            result += (b < 16 ? '0' : '') + b.toString(16);
        }
    }

    return result;
}

/**
 * Computes a deterministic deduplication fingerprint string for a candidate transaction.
 * Returns a 64-character SHA-256 hex string.
 */
export function generateSmsFingerprint(candidate: Omit<ParsedTransactionCandidate, 'rawSms' | 'warnings'>): string {
    const rawComponents = [
        candidate.providerId,
        candidate.type,
        candidate.ledgerAmount.toFixed(2),
        candidate.accountLast4?.trim() || 'none',
        candidate.reference?.trim() || 'none',
        candidate.secondaryReference?.trim() || 'none',
        candidate.dateTime?.trim() || 'none',
        candidate.currentBalance != null ? candidate.currentBalance.toFixed(2) : 'none',
    ];

    const compositeString = rawComponents.join('|');
    return sha256Hex(compositeString);
}
