import type { SmsProviderId } from '../types';

interface ProviderDefinition {
    providerId: SmsProviderId;
    strongSignatures: RegExp[];
    weakSignatures: RegExp[];
}

/**
 * Ordered list of provider signature definitions.
 * Order is authoritative: more specific or composite-referencing institutions
 * (e.g. CBE Birr before CBE; M-PESA before CBE; Awash before Dashen for interbank IPS)
 * are matched first to ensure originating routing details don't hijack destination accounts.
 */
const PROVIDERS: ProviderDefinition[] = [
    {
        providerId: 'cbe_birr',
        strongSignatures: [
            /\bchoosing\s+cbe\s*birr\b/i,
            /\bcbe\s*birr\b/i,
        ],
        weakSignatures: [
            /\bcbebirr\b/i,
        ],
    },
    {
        providerId: 'mpesa',
        strongSignatures: [
            /\byour\s+current\s+m-pesa\s+balance\b/i,
            /\bpaying\s+via\s+m-pesa\b/i,
            /\bm-pesa\s+balance\b/i,
            /\bm-pesa\s+account\b/i,
            /\bsafaricom\s+bundle\b/i,
            /\bm-pesa\b/i,
        ],
        weakSignatures: [
            /\bmpesa\b/i,
            /\bsafaricom\b/i,
        ],
    },
    {
        providerId: 'awash',
        strongSignatures: [
            /\bawash\s+bank\b/i,
            /\bawash\s+international\b/i,
        ],
        weakSignatures: [
            /\bawash\b/i,
        ],
    },
    {
        providerId: 'boa',
        strongSignatures: [
            /\bbank\s+of\s+abyssinia\b/i,
            /\bcs\.bankofabyssinia\.com\b/i,
            /\babyssinia\s+bank\b/i,
        ],
        weakSignatures: [
            /\babyssinia\b/i,
            /\bboa\b/i,
        ],
    },
    {
        providerId: 'dashen',
        strongSignatures: [
            /\balways\s+one\s+step\s+ahead\b/i,
            /(?<!via\s+(?:IPS\s+)?)dashen\s+bank\b/i,
        ],
        weakSignatures: [
            /(?<!via\s+(?:IPS\s+)?)dashen\b/i,
        ],
    },
    {
        providerId: 'telebirr',
        strongSignatures: [
            /\bethio\s*telecom\b/i,
            /\bthank\s+you\s+for\s+using\s+telebirr\b/i,
            /\b(?:from|to)\s+your\s+telebirr\s+account\b/i,
            /\byour\s+telebirr\s+transaction\s+number\b/i,
            /\bE-Money\s+Account\s+balance\b/i,
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
            /(?<!from\s+)commercial\s+bank\s+of\s+ethiopia\b/i,
        ],
        weakSignatures: [
            /\bcbe\b/i,
        ],
    },
];

/**
 * Attempts to detect the financial provider from the SMS text or sender metadata.
 * Uses a two-pass detection: authoritative institutional signatures take priority
 * over generic mentions (e.g. Awash messages naming "via IPS DASHEN BANK" correctly resolve to Awash;
 * M-PESA messages receiving funds "from Commercial Bank of Ethiopia" correctly resolve to M-PESA).
 */
export function detectProvider(text: string, senderAddress?: string): SmsProviderId | null {
    // Pass 0: Explicit sender address header (highest confidence if provided by OS)
    if (senderAddress) {
        const s = senderAddress.trim().toLowerCase();
        if (s.includes('cbebirr') || s.includes('cbe_birr')) return 'cbe_birr';
        if (s.includes('mpesa') || s.includes('m-pesa') || s.includes('safaricom')) return 'mpesa';
        if (s.includes('awash')) return 'awash';
        if (s.includes('abyssinia') || s === 'boa') return 'boa';
        if (s.includes('dashen')) return 'dashen';
        if (s.includes('telebirr')) return 'telebirr';
        if (s.includes('cbe')) return 'cbe';
    }

    // Pass 1: Authoritative strong institutional signatures in text body
    for (const provider of PROVIDERS) {
        for (const pattern of provider.strongSignatures) {
            if (pattern.test(text)) {
                return provider.providerId;
            }
        }
    }

    // Pass 2: Secondary / weak signatures
    for (const provider of PROVIDERS) {
        for (const pattern of provider.weakSignatures) {
            if (pattern.test(text)) {
                return provider.providerId;
            }
        }
    }

    return null;
}
