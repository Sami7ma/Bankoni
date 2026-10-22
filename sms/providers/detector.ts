// sms/providers/detector.ts
// Detects supported Ethiopian financial providers from SMS content or sender metadata.
// Pure TypeScript domain logic.

import type { SmsProviderId } from '../types';

interface ProviderDefinition {
    providerId: SmsProviderId;
    strongSignatures: RegExp[];
    weakSignatures: RegExp[];
}

const PROVIDERS: ProviderDefinition[] = [
    {
        providerId: 'dashen',
        strongSignatures: [
            /\bdashen\s+bank\b/i,
            /\balways\s+one\s+step\s+ahead\b/i,
        ],
        weakSignatures: [
            /\bdashen\b/i,
        ],
    },
    {
        providerId: 'telebirr',
        strongSignatures: [
            /\bethio\s*telecom\b/i,
            /\bthank\s+you\s+for\s+using\s+telebirr\b/i,
            /\b(?:from|to)\s+your\s+telebirr\s+account\b/i,
            /\byour\s+telebirr\s+transaction\s+number\b/i,
        ],
        weakSignatures: [
            /\btelebirr\b/i,
        ],
    },
    {
        providerId: 'cbe',
        strongSignatures: [
            /\bbanking\s+with\s+cbe\b/i,
            /\bapps\.cbe\.com\.et\b/i,
            /\bcbebirr\b/i,
            /\bcommercial\s+bank\s+of\s+ethiopia\b/i,
        ],
        weakSignatures: [
            /\bcbe\b/i,
        ],
    },
];

/**
 * Attempts to detect the financial provider from the SMS text or sender metadata.
 * Uses a two-pass detection: authoritative institutional signatures take priority
 * over generic mentions (e.g. Dashen messages naming "from Telebirr" correctly resolve to Dashen).
 */
export function detectProvider(text: string, senderAddress?: string): SmsProviderId | null {
    const combined = `${senderAddress || ''} ${text}`;

    // Pass 1: Authoritative strong institutional signatures
    for (const provider of PROVIDERS) {
        for (const pattern of provider.strongSignatures) {
            if (pattern.test(combined)) {
                return provider.providerId;
            }
        }
    }

    // Pass 2: Secondary / weak signatures
    for (const provider of PROVIDERS) {
        for (const pattern of provider.weakSignatures) {
            if (pattern.test(combined)) {
                return provider.providerId;
            }
        }
    }

    return null;
}
