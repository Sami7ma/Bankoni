// sms/index.ts
// Unified pure TypeScript entry point for BanKoni SMS transaction parsing.

import { normalizeSmsText } from './cleaners';
import { classifyMessage } from './classifier';
import { detectProvider } from './providers/detector';
import { parseCbeSms } from './providers/cbe';
import { parseDashenSms } from './providers/dashen';
import { parseTelebirrSms } from './providers/telebirr';
import type { SmsProviderId, SmsParseResult } from './types';

export * from './types';
export * from './cleaners';
export * from './classifier';
export * from './fingerprint';
export * from './matcher';
export { detectProvider } from './providers/detector';

/**
 * Parses raw SMS text into a structured transaction candidate or a typed rejection outcome.
 *
 * @param rawText The raw SMS text input by the user.
 * @param preferredProvider Optional provider specified by the user ('cbe', 'dashen', 'telebirr').
 * @param senderAddress Optional sender header (e.g., 'CBE', 'telebirr').
 */
export function parseSms(
    rawText: string,
    preferredProvider?: SmsProviderId | 'auto',
    senderAddress?: string
): SmsParseResult {
    const text = normalizeSmsText(rawText);
    if (!text) {
        return {
            status: 'malformed',
            reason: 'SMS message text is empty.',
        };
    }

    // Step 1: Check if message is a non-ledger event (OTP, authorization, airtime receipt, etc.)
    const classification = classifyMessage(text);
    if (classification.isNonTransaction) {
        return {
            status: 'non_transaction',
            reason: classification.reason || 'Message does not represent a completed financial ledger transaction.',
            messageType: classification.messageType,
        };
    }

    // Step 2: Determine financial provider
    let providerId: SmsProviderId | null = null;
    if (preferredProvider && preferredProvider !== 'auto') {
        providerId = preferredProvider;
    } else {
        providerId = detectProvider(text, senderAddress);
    }

    if (!providerId) {
        return {
            status: 'unsupported_provider',
            reason: 'Could not determine whether this message is from Commercial Bank of Ethiopia (CBE), Dashen Bank, or Telebirr. Please choose a provider manually.',
        };
    }

    // Step 3: Route to provider-specific parser
    switch (providerId) {
        case 'cbe':
            return parseCbeSms(text);
        case 'dashen':
            return parseDashenSms(text);
        case 'telebirr':
            return parseTelebirrSms(text);
        default:
            return {
                status: 'unsupported_provider',
                reason: `Provider '${providerId}' is not currently supported. Supported providers are CBE, Dashen Bank, and Telebirr.`,
            };
    }
}
