// sms/matcher.ts
// Pure domain logic for matching parsed SMS candidates to existing BanKoni user wallets.

import type { Wallet } from '../types/Wallet';
import type { ParsedTransactionCandidate } from './types';

export interface WalletMatchOutcome {
    matchedWallet: Wallet | null;
    confidence: 'exact_account' | 'provider_only' | 'ambiguous' | 'none';
    candidateWallets: Wallet[];
}

/**
 * Matches a parsed transaction candidate against the user's active wallets.
 * Never silently chooses an arbitrary wallet if multiple candidates could apply.
 */
export function matchWalletForCandidate(
    candidate: ParsedTransactionCandidate,
    wallets: Wallet[]
): WalletMatchOutcome {
    // 1. Only consider non-archived wallets matching currency (ETB)
    const activeEtbWallets = wallets.filter(
        (w) => !w.isArchived && (w.currency === 'ETB' || !w.currency)
    );

    // 2. Filter by provider ID ('cbe', 'dashen', 'telebirr')
    const providerWallets = activeEtbWallets.filter(
        (w) => w.providerId && w.providerId.toLowerCase() === candidate.providerId.toLowerCase()
    );

    if (providerWallets.length === 0) {
        return {
            matchedWallet: null,
            confidence: 'none',
            candidateWallets: [],
        };
    }

    // 3. If account last 4 digits are available, attempt exact account match
    if (candidate.accountLast4) {
        const exactMatches = providerWallets.filter(
            (w) => w.accountNumberLast4 && w.accountNumberLast4.trim() === candidate.accountLast4
        );

        if (exactMatches.length === 1) {
            return {
                matchedWallet: exactMatches[0],
                confidence: 'exact_account',
                candidateWallets: exactMatches,
            };
        }

        if (exactMatches.length > 1) {
            return {
                matchedWallet: null,
                confidence: 'ambiguous',
                candidateWallets: exactMatches,
            };
        }
    }

    // 4. Fallback to provider-level match
    if (providerWallets.length === 1) {
        return {
            matchedWallet: providerWallets[0],
            confidence: 'provider_only',
            candidateWallets: providerWallets,
        };
    }

    // Multiple wallets exist for this provider and none matched exact account last 4
    return {
        matchedWallet: null,
        confidence: 'ambiguous',
        candidateWallets: providerWallets,
    };
}
