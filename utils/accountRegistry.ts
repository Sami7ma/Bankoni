// utils/accountRegistry.ts
//
// Persistent Known Accounts Registry for BanKoni.
// Normalizes, masks, and matches Ethiopian bank accounts and mobile wallets.
// Completely local, offline, deterministic logic.

import type { KnownAccount, AccountOwnership, AccountType } from '../types/FinancialRelationships';
import type { Wallet } from '../types/Wallet';
import { extractAccountLast4 } from '../sms/cleaners';

/**
 * Normalizes an Ethiopian phone number to international 12-digit standard '2519...'
 * or returns raw alphanumeric if not an Ethiopian phone number.
 * Examples:
 *   "+251989972336" -> "251989972336"
 *   "0989972336"    -> "251989972336"
 *   "989972336"     -> "251989972336"
 *   "0712345678"    -> "251712345678"
 */
export function normalizePhoneNumber(raw: string): string {
    const cleaned = raw.trim().replace(/[\s-+]/g, '');
    if (/^251[79]\d{8}$/.test(cleaned)) {
        return cleaned;
    }
    if (/^0[79]\d{8}$/.test(cleaned)) {
        return `251${cleaned.slice(1)}`;
    }
    if (/^[79]\d{8}$/.test(cleaned)) {
        return `251${cleaned}`;
    }
    return cleaned;
}

/**
 * Normalizes any account identifier (bank account or phone number).
 * Preserves asterisks for masked accounts (e.g. 1********2293).
 */
export function normalizeAccountIdentifier(raw: string): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    // If it looks like a phone number without mask
    if (/^(\+?251|0)?[79]\d{8}$/.test(trimmed.replace(/[\s-+]/g, ''))) {
        return normalizePhoneNumber(trimmed);
    }
    // Remove formatting punctuation, preserve digits and asterisks
    return trimmed.replace(/[^\dA-Za-z*]/g, '');
}

/**
 * Masks an account identifier for user-friendly, privacy-preserving display.
 * Examples:
 *   "251989972336" -> "09****2336"
 *   "0989972336"   -> "09****2336"
 *   "100012342293" -> "1********2293"
 *   "1********2293" -> "1********2293"
 */
export function maskAccountIdentifier(account: string, providerId?: string): string {
    if (!account) return '';
    const normalized = normalizeAccountIdentifier(account);

    // If it's already masked, return as-is
    if (normalized.includes('*')) {
        return normalized;
    }

    // Phone number
    if (/^251[79]\d{8}$/.test(normalized)) {
        const local = `0${normalized.slice(3)}`;
        return `${local.slice(0, 2)}****${local.slice(-4)}`;
    }

    // Bank account (10+ digits)
    if (/^\d{10,}$/.test(normalized)) {
        const first = normalized[0];
        const last4 = normalized.slice(-4);
        const stars = '*'.repeat(Math.max(normalized.length - 5, 4));
        return `${first}${stars}${last4}`;
    }

    // Shorter accounts
    if (normalized.length > 4) {
        return `****${normalized.slice(-4)}`;
    }

    return normalized;
}

/**
 * Normalizes provider identifiers across varied naming formats in Ethiopian financial SMS.
 * Maps:
 *   "Commercial Bank of Ethiopia", "CBE", "CBEBirr" -> "cbe"
 *   "telebirr", "Ethio telecom" -> "telebirr"
 *   "Bank of Abyssinia", "BOA" -> "boa"
 *   "Dashen Bank", "Dashen" -> "dashen"
 *   "Awash Bank", "Awash" -> "awash"
 *   "M-PESA", "Safaricom" -> "mpesa"
 */
export function detectProviderFromText(text: string): string | undefined {
    if (!text) return undefined;
    const lower = text.toLowerCase();

    if (lower.includes('commercial bank') || lower.includes('cbe') || lower.includes('የኢትዮጵያ ንግድ ባንክ')) {
        if (lower.includes('cbe birr') || lower.includes('cbebirr')) return 'cbe_birr';
        return 'cbe';
    }
    if (lower.includes('telebirr') || lower.includes('ethio telecom') || lower.includes('ቴሌብር')) {
        return 'telebirr';
    }
    if (lower.includes('abyssinia') || lower.includes('boa') || lower.includes('አቢሲኒያ')) {
        return 'boa';
    }
    if (lower.includes('dashen') || lower.includes('ዳሸን')) {
        return 'dashen';
    }
    if (lower.includes('awash') || lower.includes('አዋሽ')) {
        return 'awash';
    }
    if (lower.includes('mpesa') || lower.includes('m-pesa') || lower.includes('safaricom')) {
        return 'mpesa';
    }
    return undefined;
}

/**
 * Checks whether an evidence account identifier matches a registered KnownAccount.
 * Supports:
 *   1. Exact normalized matches
 *   2. Phone number variants (+2519 vs 09 vs masked 09****2336)
 *   3. Masked bank accounts (e.g. 1********2293 matches 100012342293 or CBE account ending in 2293)
 *   4. Provider and last 4 matching
 */
export function isAccountMatch(
    evidence:
        | {
              providerId?: string;
              accountIdentifier?: string;
              accountLast4?: string;
          }
        | string,
    account: KnownAccount | string
): boolean {
    // If both arguments are strings, compare them directly
    if (typeof evidence === 'string' && typeof account === 'string') {
        const identA = normalizeAccountIdentifier(evidence);
        const identB = normalizeAccountIdentifier(account);
        if (!identA || !identB) return false;
        if (identA === identB) return true;

        const last4A = identA.replace(/[*]/g, '').slice(-4);
        const last4B = identB.replace(/[*]/g, '').slice(-4);

        if (identA.includes('*') || identB.includes('*')) {
            if (last4A && last4B && last4A === last4B) {
                const firstA = identA.replace(/[*]/g, '')[0];
                const firstB = identB.replace(/[*]/g, '')[0];
                if (!firstA || !firstB || firstA === firstB) return true;
            }
        }

        if (identA.length === 4 && (last4B === identA || identB.endsWith(identA))) return true;
        if (identB.length === 4 && (last4A === identB || identA.endsWith(identB))) return true;

        if (/^251[79]\d{8}$/.test(identA) && /^251[79]\d{8}$/.test(identB)) {
            return identA === identB;
        }
        return false;
    }

    // Normalize evidence object
    const evObj =
        typeof evidence === 'string'
            ? {
                  accountIdentifier: evidence,
                  accountLast4: extractAccountLast4(evidence),
              }
            : evidence;

    // Normalize account object
    const acctObj =
        typeof account === 'string'
            ? ({
                  accountNumber: account,
                  accountLast4: extractAccountLast4(account),
                  maskedIdentifier: maskAccountIdentifier(account),
                  providerId: '',
                  displayName: '',
                  id: '',
                  ownership: 'EXTERNAL' as const,
                  accountType: 'bank' as const,
                  createdAt: '',
              } as KnownAccount)
            : account;

    // 1. If provider is specified on both sides, they must match
    if (evObj.providerId && acctObj.providerId) {
        const provA = evObj.providerId.toLowerCase();
        const provB = acctObj.providerId.toLowerCase();
        if (provA !== provB) {
            // Also check provider normalization alias
            const normA = detectProviderFromText(provA) || provA;
            const normB = detectProviderFromText(provB) || provB;
            if (normA !== normB) return false;
        }
    }

    const evidenceLast4 =
        evObj.accountLast4 || (evObj.accountIdentifier ? extractAccountLast4(evObj.accountIdentifier) : undefined);
    const accountLast4 =
        acctObj.accountLast4 ||
        extractAccountLast4(acctObj.accountNumber) ||
        extractAccountLast4(acctObj.maskedIdentifier);

    // 2. Exact normalized match
    if (evObj.accountIdentifier && acctObj.accountNumber) {
        const normEvidence = normalizeAccountIdentifier(evObj.accountIdentifier);
        const normAccount = normalizeAccountIdentifier(acctObj.accountNumber);

        if (normEvidence && normAccount && normEvidence === normAccount) {
            return true;
        }

        // Ethiopian phone match: 2519... vs 09...
        if (/^251[79]\d{8}$/.test(normEvidence) && /^251[79]\d{8}$/.test(normAccount)) {
            return normEvidence === normAccount;
        }
    }

    // 3. Masked account match (e.g. evidence "1********2293" vs account "100012342293")
    if (evObj.accountIdentifier && (acctObj.accountNumber || acctObj.maskedIdentifier)) {
        const evId = normalizeAccountIdentifier(evObj.accountIdentifier);
        const acctId = normalizeAccountIdentifier(acctObj.accountNumber || acctObj.maskedIdentifier);

        if (evId.includes('*') || acctId.includes('*')) {
            // Both must match on last 4 digits
            if (evidenceLast4 && accountLast4 && evidenceLast4 === accountLast4) {
                // If leading non-star character matches (e.g. both start with '1')
                const evFirst = evId.replace(/[*]/g, '')[0];
                const acctFirst = acctId.replace(/[*]/g, '')[0];
                if (!evFirst || !acctFirst || evFirst === acctFirst) {
                    return true;
                }
            }
        }
    }

    // 4. Provider + Last 4 digits match
    if (evObj.providerId && acctObj.providerId && evidenceLast4 && accountLast4) {
        const provA = (detectProviderFromText(evObj.providerId) || evObj.providerId).toLowerCase();
        const provB = (detectProviderFromText(acctObj.providerId) || acctObj.providerId).toLowerCase();
        if (provA === provB && evidenceLast4 === accountLast4) {
            return true;
        }
    }

    return false;
}

/**
 * Searches the Known Accounts registry for an account matching the provided evidence.
 */
export function findKnownAccount(
    accounts: KnownAccount[],
    providerOrEvidence:
        | {
              providerId?: string;
              accountIdentifier?: string;
              accountLast4?: string;
          }
        | string,
    accountIdentifier?: string
): KnownAccount | null {
    let evidenceObj: {
        providerId?: string;
        accountIdentifier?: string;
        accountLast4?: string;
    };

    if (typeof providerOrEvidence === 'string') {
        const last4 = accountIdentifier ? extractAccountLast4(accountIdentifier) : undefined;
        evidenceObj = {
            providerId: providerOrEvidence,
            accountIdentifier,
            accountLast4: last4,
        };
    } else {
        evidenceObj = providerOrEvidence;
    }

    for (const acct of accounts) {
        if (isAccountMatch(evidenceObj, acct)) {
            return acct;
        }
    }
    return null;
}

/**
 * Synchronizes user wallets to Known Accounts so every active wallet has a known account representation.
 */
export function syncWalletsToKnownAccounts(
    wallets: Wallet[],
    existingAccounts: KnownAccount[]
): KnownAccount[] {
    const result = [...existingAccounts];
    const existingWalletMap = new Map<string, KnownAccount>();
    for (const a of existingAccounts) {
        if (a.walletId) existingWalletMap.set(a.walletId, a);
    }

    const now = new Date().toISOString();

    for (const w of wallets) {
        if (w.isArchived) continue;
        if (!existingWalletMap.has(w.id)) {
            const last4 = w.accountNumberLast4 || extractAccountLast4(w.name);
            const providerId = w.providerId || 'custom';
            const acctType: AccountType =
                providerId === 'telebirr' || providerId === 'mpesa'
                    ? 'mobile_money'
                    : providerId === 'cash'
                    ? 'cash'
                    : 'bank';

            const defaultAccount = last4 ? `acct_${last4}` : `wallet_${w.id}`;
            const masked = last4 ? `****${last4}` : w.name;

            const newAccount: KnownAccount = {
                id: `ka-${w.id}`,
                walletId: w.id,
                providerId,
                accountType: acctType,
                accountNumber: defaultAccount,
                accountLast4: last4,
                displayName: w.name,
                maskedIdentifier: masked,
                ownership: 'OWN',
                createdAt: now,
            };

            result.push(newAccount);
            existingWalletMap.set(w.id, newAccount);
        }
    }

    return result;
}
