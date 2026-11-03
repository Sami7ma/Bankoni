// sms/transferCorrelator.ts
//
// Dedicated own-account and inter-account transfer classification and correlation engine.
// Supports:
//  - Bank-to-wallet transfers (e.g. CBE to Telebirr)
//  - Wallet-to-bank transfers (e.g. Telebirr to CBE)
//  - Bank-to-bank and wallet-to-wallet transfers
//  - Arrival in either order (Debit first or Credit first)
//  - Separates principal transfer amount from transaction fees and taxes
//  - Reconciles source and destination wallet balances from authoritative SMS evidence
//  - Completely local, offline, deterministic logic

import type { Transaction } from '../types/Transaction';
import type { Wallet } from '../types/Wallet';
import type {
    KnownAccount,
    TransferCorrelationResult,
    TransferMatchStatus,
} from '../types/FinancialRelationships';
import type { ParsedTransactionCandidate } from './types';
import {
    detectProviderFromText,
    isAccountMatch,
    findKnownAccount,
    maskAccountIdentifier,
} from '../utils/accountRegistry';
import { extractAccountLast4 } from './cleaners';

export interface TransferEvidence {
    isTransfer: boolean;
    direction: 'INCOMING' | 'OUTGOING';
    principalAmount: number;
    feeAmount: number;
    totalDebitAmount: number;
    sourceProvider?: string;
    destinationProvider?: string;
    sourceAccountIdentifier?: string;
    destinationAccountIdentifier?: string;
    sourceAccountLast4?: string;
    destinationAccountLast4?: string;
    counterpartyName?: string;
    reference?: string;
    dateTime?: string;
    currentBalance?: number;
}

/**
 * Inspects a parsed candidate and raw SMS text to extract transfer metadata and provider identities.
 */
export function extractTransferEvidence(
    candidate: ParsedTransactionCandidate,
    rawText: string = ''
): TransferEvidence {
    const text = (rawText || candidate.rawSms || '').toLowerCase();
    const principal = candidate.principalAmount;
    const feeAmount = candidate.fees?.totalFees ?? 0;
    const totalDebit = candidate.ledgerAmount;

    // Check for explicit transfer patterns
    // 1. CBE Outgoing Debit:
    // "A debit transaction of ETB 370.0. has occurred on your account 1********2293. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB382.00."
    const isCbeDebitWithFees =
        candidate.providerId === 'cbe' &&
        candidate.type === 'DEBIT' &&
        (feeAmount > 0 || /service\s+charge|total\s+of\s+etb/i.test(text));

    // 2. Telebirr Incoming from Bank:
    // "You have received ETB 370.00 by transaction number DK17JQBOW5 on ... from Commercial Bank of Ethiopia to your telebirr Account 251989972336 - SAMUEL MIFITA AWOL."
    const isTelebirrIncomingFromBank =
        candidate.providerId === 'telebirr' &&
        candidate.type === 'CREDIT' &&
        (candidate.counterparty ? detectProviderFromText(candidate.counterparty) != null : false);

    // 3. Telebirr Outgoing to Bank:
    // "You have transferred ETB 1,000.00 successfully from your telebirr account 09****1234 to Commercial Bank of Ethiopia account number 1000****5678"
    const isTelebirrOutgoingToBank =
        candidate.providerId === 'telebirr' &&
        candidate.type === 'DEBIT' &&
        /transferred\s+etb.+?to\s+.+?account/i.test(text);

    // 4. General Transfer keywords
    const hasTransferKeywords =
        /transferred\s+etb|transfer\s+to|transfer\s+from|from\s+commercial\s+bank|to\s+commercial\s+bank/i.test(text);

    let sourceProvider: string | undefined = undefined;
    let destinationProvider: string | undefined = undefined;
    let sourceAcct: string | undefined = undefined;
    let destAcct: string | undefined = undefined;

    if (candidate.type === 'DEBIT') {
        sourceProvider = candidate.providerId;
        sourceAcct = candidate.accountIdentifier;

        if (isTelebirrOutgoingToBank) {
            const destMatch = rawText.match(/to\s+(.+?)\s+account\s+(?:number\s+)?([^\s]+)/i);
            if (destMatch) {
                destinationProvider = detectProviderFromText(destMatch[1]) || destMatch[1].trim();
                destAcct = destMatch[2].replace(/[.,]$/, '');
            }
        } else {
            // General outgoing debit transfer to bank account: "to account 100099998888 (Abebe Bikila)"
            const cbeDestMatch = rawText.match(/to\s+account\s+([^\s(]+)(?:\s*\(([^)]+)\))?/i);
            if (cbeDestMatch) {
                destAcct = cbeDestMatch[1].replace(/[.,]$/, '');
                destinationProvider = candidate.providerId; // intra-bank transfer
            } else {
                // Telebirr P2P / phone transfer: "to 251911223344 (Abebe Kebede)" or "to 0911223344"
                const phoneDestMatch = rawText.match(/to\s+([0-9+*]{9,})(?:\s*\(([^)]+)\))?/i);
                if (phoneDestMatch) {
                    destAcct = phoneDestMatch[1].replace(/[.,]$/, '');
                    destinationProvider = candidate.providerId; // mobile wallet P2P
                }
            }
        }

        if (!destAcct && candidate.counterparty) {
            const acctInCounterparty = candidate.counterparty.match(/(?:Acct|Account)\s+([^\s)]+)/i);
            if (acctInCounterparty) {
                destAcct = acctInCounterparty[1].replace(/[.,]$/, '');
            } else {
                const phoneInCounterparty = candidate.counterparty.match(/^([0-9+*]{9,})/);
                if (phoneInCounterparty) {
                    destAcct = phoneInCounterparty[1].replace(/[.,]$/, '');
                }
            }
            if (!destinationProvider) {
                destinationProvider = detectProviderFromText(candidate.counterparty) || candidate.providerId;
            }
        }
    } else {
        destinationProvider = candidate.providerId;
        destAcct = candidate.accountIdentifier;

        if (candidate.counterparty) {
            sourceProvider = detectProviderFromText(candidate.counterparty) || candidate.counterparty;
        }
    }

    const isTransfer =
        isCbeDebitWithFees ||
        isTelebirrIncomingFromBank ||
        isTelebirrOutgoingToBank ||
        hasTransferKeywords;

    return {
        isTransfer,
        direction: candidate.type === 'DEBIT' ? 'OUTGOING' : 'INCOMING',
        principalAmount: principal,
        feeAmount,
        totalDebitAmount: totalDebit,
        sourceProvider,
        destinationProvider,
        sourceAccountIdentifier: sourceAcct,
        destinationAccountIdentifier: destAcct,
        sourceAccountLast4: sourceAcct ? extractAccountLast4(sourceAcct) : candidate.accountLast4,
        destinationAccountLast4: destAcct ? extractAccountLast4(destAcct) : undefined,
        counterpartyName: candidate.counterparty,
        reference: candidate.reference,
        dateTime: candidate.dateTime,
        currentBalance: candidate.currentBalance,
    };
}

/**
 * Intelligently correlates a parsed SMS transaction candidate with existing transactions
 * and the user's Known Accounts Registry to detect own-account transfers.
 *
 * Core guarantees:
 *  1. Supports either arrival order (Debit first or Credit first).
 *  2. Prevents creating duplicate transactions when both legs arrive.
 *  3. Distinguishes own-account transfers from transfers to external people.
 *  4. Accurately maintains principal vs fees.
 */
export function correlateTransfer(
    candidate: ParsedTransactionCandidate,
    rawTextOrContext:
        | string
        | {
              existingTransactions?: Transaction[];
              wallets?: Wallet[];
              knownAccounts?: KnownAccount[];
          } = '',
    maybeContext?: {
        existingTransactions?: Transaction[];
        wallets?: Wallet[];
        knownAccounts?: KnownAccount[];
    }
): TransferCorrelationResult {
    let rawText = '';
    let context: {
        existingTransactions: Transaction[];
        wallets: Wallet[];
        knownAccounts: KnownAccount[];
    } = {
        existingTransactions: [],
        wallets: [],
        knownAccounts: [],
    };

    if (typeof rawTextOrContext === 'string') {
        rawText = rawTextOrContext;
        if (maybeContext) {
            context = {
                existingTransactions: maybeContext.existingTransactions || [],
                wallets: maybeContext.wallets || [],
                knownAccounts: maybeContext.knownAccounts || [],
            };
        }
    } else if (typeof rawTextOrContext === 'object' && rawTextOrContext !== null) {
        context = {
            existingTransactions: rawTextOrContext.existingTransactions || [],
            wallets: rawTextOrContext.wallets || [],
            knownAccounts: rawTextOrContext.knownAccounts || [],
        };
        rawText = candidate.rawSms || '';
    }

    const evidence = extractTransferEvidence(candidate, rawText);
    const { existingTransactions, wallets, knownAccounts } = context;

    // Helper to find wallet by provider ID
    const findWalletByProvider = (providerId?: string, last4?: string): Wallet | undefined => {
        if (!providerId) return undefined;
        const norm = (detectProviderFromText(providerId) || providerId).toLowerCase();
        const active = wallets.filter((w) => !w.isArchived);

        if (last4) {
            return active.find(
                (w) =>
                    (detectProviderFromText(w.providerId) || w.providerId).toLowerCase() === norm &&
                    (w.accountNumberLast4 === last4 || isAccountMatch(w.accountNumberLast4 || '', last4))
            );
        }

        return active.find(
            (w) => (detectProviderFromText(w.providerId) || w.providerId).toLowerCase() === norm
        );
    };

    // Helper to find known account
    const resolveKnownAccount = (providerId?: string, identifier?: string): KnownAccount | null => {
        if (!identifier && !providerId) return null;
        return findKnownAccount(knownAccounts, {
            providerId: providerId ? detectProviderFromText(providerId) || providerId : undefined,
            accountIdentifier: identifier,
            accountLast4: identifier ? extractAccountLast4(identifier) : undefined,
        });
    };

    // ─────────────────────────────────────────────────────────
    // STEP 1: Check for existing opposite leg in existingTransactions
    // ─────────────────────────────────────────────────────────
    if (evidence.isTransfer) {
        if (candidate.type === 'CREDIT') {
            // Incoming Credit (e.g. Telebirr credit of 370 from CBE)
            // Look for an existing DEBIT transaction that represents the source debit leg
            const matchingDebit = existingTransactions.find((tx) => {
                if (tx.type !== 'DEBIT' || tx.status !== 'CLEARED') return false;

                // Match principal amount (e.g. 370.00) or total ledger (e.g. 382.00)
                const amtDiff = Math.abs(tx.amount - evidence.principalAmount);
                const isExactPrincipal = amtDiff < 0.05;
                const isDebitWithFee = tx.feeAmount != null && Math.abs((tx.amount + tx.feeAmount) - evidence.totalDebitAmount) < 0.05;
                const isStatedTotal = Math.abs(tx.amount - (evidence.principalAmount + (candidate.fees?.totalFees ?? 0))) < 0.05;

                if (!isExactPrincipal && !isDebitWithFee && !isStatedTotal) return false;

                // Check wallet provider
                const debitWallet = wallets.find((w) => w.id === tx.walletId);
                if (!debitWallet) return false;

                const debitProv = (detectProviderFromText(debitWallet.providerId) || debitWallet.providerId).toLowerCase();
                const expectedSourceProv = evidence.sourceProvider
                    ? (detectProviderFromText(evidence.sourceProvider) || evidence.sourceProvider).toLowerCase()
                    : undefined;

                if (expectedSourceProv && debitProv !== expectedSourceProv) {
                    return false;
                }

                return true;
            });

            if (matchingDebit) {
                const sourceWallet = wallets.find((w) => w.id === matchingDebit.walletId);
                const destWallet =
                    findWalletByProvider(candidate.providerId, candidate.accountLast4) ||
                    wallets.find((w) => w.id === candidate.accountIdentifier);

                const fee = matchingDebit.feeAmount ?? candidate.fees?.totalFees ?? 0;

                return {
                    status: 'OWN_ACCOUNT_MATCHED',
                    isOwnAccountTransfer: true,
                    sourceWalletId: sourceWallet?.id,
                    destinationWalletId: destWallet?.id,
                    sourceAccount: sourceWallet ? resolveKnownAccount(sourceWallet.providerId, sourceWallet.accountNumberLast4) ?? undefined : undefined,
                    destinationAccount: destWallet ? resolveKnownAccount(destWallet.providerId, candidate.accountIdentifier) ?? undefined : undefined,
                    principalAmount: evidence.principalAmount,
                    feeAmount: fee,
                    totalDebitAmount: Number((evidence.principalAmount + fee).toFixed(2)),
                    destinationCreditAmount: evidence.principalAmount,
                    sourceReference: matchingDebit.smsReference,
                    destinationReference: candidate.reference,
                    matchedTransactionId: matchingDebit.id,
                    matchedTransaction: matchingDebit,
                    reconciledSourceBalance: matchingDebit.currentBalance,
                    reconciledDestinationBalance: candidate.currentBalance,
                    reason: `Correlated with existing debit on ${sourceWallet?.name ?? 'source account'} of ETB ${evidence.principalAmount}`,
                };
            }
        } else {
            // Outgoing Debit (e.g. CBE debit of 370 + 12 fee)
            // Look for an existing CREDIT transaction that represents the destination credit leg
            const matchingCredit = existingTransactions.find((tx) => {
                if (tx.type !== 'CREDIT' || tx.status !== 'CLEARED') return false;

                const isExactPrincipal = Math.abs(tx.amount - evidence.principalAmount) < 0.05;
                if (!isExactPrincipal) return false;

                // Check destination wallet
                const creditWallet = wallets.find((w) => w.id === tx.walletId);
                if (!creditWallet) return false;

                // If candidate mentions destination or credit mentions source provider
                const creditProv = (detectProviderFromText(creditWallet.providerId) || creditWallet.providerId).toLowerCase();
                const candProv = (detectProviderFromText(candidate.providerId) || candidate.providerId).toLowerCase();

                // If credit counterparty mentions this candidate's provider
                if (tx.counterparty) {
                    const counterProv = (detectProviderFromText(tx.counterparty) || tx.counterparty).toLowerCase();
                    if (counterProv === candProv) return true;
                }

                // If credit is on mobile wallet (e.g. Telebirr) and candidate is on Bank (e.g. CBE)
                if (creditProv === 'telebirr' && candProv === 'cbe') return true;

                return false;
            });

            if (matchingCredit) {
                const sourceWallet =
                    findWalletByProvider(candidate.providerId, candidate.accountLast4) ||
                    wallets.find((w) => w.id === candidate.accountIdentifier);
                const destWallet = wallets.find((w) => w.id === matchingCredit.walletId);

                const fee = candidate.fees?.totalFees ?? 0;

                return {
                    status: 'OWN_ACCOUNT_MATCHED',
                    isOwnAccountTransfer: true,
                    sourceWalletId: sourceWallet?.id,
                    destinationWalletId: destWallet?.id,
                    sourceAccount: sourceWallet ? resolveKnownAccount(sourceWallet.providerId, candidate.accountIdentifier) ?? undefined : undefined,
                    destinationAccount: destWallet ? resolveKnownAccount(destWallet.providerId, destWallet.accountNumberLast4) ?? undefined : undefined,
                    principalAmount: evidence.principalAmount,
                    feeAmount: fee,
                    totalDebitAmount: Number((evidence.principalAmount + fee).toFixed(2)),
                    destinationCreditAmount: evidence.principalAmount,
                    sourceReference: candidate.reference,
                    destinationReference: matchingCredit.smsReference,
                    matchedTransactionId: matchingCredit.id,
                    matchedTransaction: matchingCredit,
                    reconciledSourceBalance: candidate.currentBalance,
                    reconciledDestinationBalance: matchingCredit.currentBalance,
                    reason: `Correlated with existing credit on ${destWallet?.name ?? 'destination account'} of ETB ${evidence.principalAmount}`,
                };
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    // STEP 2: No existing opposite leg in DB yet.
    // Check if the candidate itself is an Own-Account Transfer Candidate.
    // ─────────────────────────────────────────────────────────
    if (evidence.isTransfer) {
        if (candidate.type === 'CREDIT' && evidence.sourceProvider) {
            // Incoming to user's wallet from a bank where user has an account
            const destWallet = findWalletByProvider(candidate.providerId, candidate.accountLast4);
            const sourceWallet = findWalletByProvider(evidence.sourceProvider);

            const destAccount = resolveKnownAccount(candidate.providerId, candidate.accountIdentifier);
            const sourceAccount = resolveKnownAccount(evidence.sourceProvider);

            const isOwnSource = (sourceAccount && sourceAccount.ownership === 'OWN') || sourceWallet != null;
            const isOwnDest = (destAccount && destAccount.ownership === 'OWN') || destWallet != null;

            if (isOwnSource && isOwnDest) {
                return {
                    status: 'OWN_ACCOUNT_CANDIDATE',
                    isOwnAccountTransfer: true,
                    sourceWalletId: sourceWallet?.id,
                    destinationWalletId: destWallet?.id,
                    sourceAccount: sourceAccount ?? undefined,
                    destinationAccount: destAccount ?? undefined,
                    principalAmount: evidence.principalAmount,
                    feeAmount: evidence.feeAmount,
                    totalDebitAmount: evidence.totalDebitAmount,
                    destinationCreditAmount: evidence.principalAmount,
                    destinationReference: candidate.reference,
                    reconciledDestinationBalance: candidate.currentBalance,
                    reason: `Incoming own-account transfer from ${sourceWallet?.name ?? evidence.sourceProvider} to ${destWallet?.name ?? candidate.providerId}`,
                };
            }
        } else if (candidate.type === 'DEBIT') {
            // Outgoing from user's wallet to a bank or mobile account or external recipient
            const sourceWallet = findWalletByProvider(candidate.providerId, candidate.accountLast4);
            const sourceAccount = resolveKnownAccount(candidate.providerId, candidate.accountIdentifier);

            const hasExplicitDestination = Boolean(
                evidence.destinationProvider ||
                evidence.destinationAccountIdentifier ||
                candidate.counterparty
            );

            if (hasExplicitDestination) {
                const destWallet = evidence.destinationProvider
                    ? findWalletByProvider(evidence.destinationProvider, extractAccountLast4(evidence.destinationAccountIdentifier))
                    : undefined;
                const destAccount = resolveKnownAccount(
                    evidence.destinationProvider || candidate.providerId,
                    evidence.destinationAccountIdentifier
                );

                const isOwnDest = (destAccount && destAccount.ownership === 'OWN') || destWallet != null;

                if (isOwnDest) {
                    return {
                        status: 'OWN_ACCOUNT_CANDIDATE',
                        isOwnAccountTransfer: true,
                        sourceWalletId: sourceWallet?.id,
                        destinationWalletId: destWallet?.id,
                        sourceAccount: sourceAccount ?? undefined,
                        destinationAccount: destAccount ?? undefined,
                        principalAmount: evidence.principalAmount,
                        feeAmount: evidence.feeAmount,
                        totalDebitAmount: evidence.totalDebitAmount,
                        destinationCreditAmount: evidence.principalAmount,
                        sourceReference: candidate.reference,
                        reconciledSourceBalance: candidate.currentBalance,
                        reason: `Outgoing own-account transfer from ${sourceWallet?.name ?? candidate.providerId} to ${destWallet?.name ?? evidence.destinationProvider ?? 'destination'}`,
                    };
                } else {
                    return {
                        status: 'EXTERNAL_TRANSFER',
                        isOwnAccountTransfer: false,
                        sourceWalletId: sourceWallet?.id,
                        sourceAccount: sourceAccount ?? undefined,
                        destinationAccount: destAccount ?? undefined,
                        principalAmount: evidence.principalAmount,
                        feeAmount: evidence.feeAmount,
                        totalDebitAmount: evidence.totalDebitAmount,
                        destinationCreditAmount: evidence.principalAmount,
                        sourceReference: candidate.reference,
                        reconciledSourceBalance: candidate.currentBalance,
                        reason: `Transfer to external recipient (${evidence.destinationProvider ?? ''} ${evidence.destinationAccountIdentifier ? maskAccountIdentifier(evidence.destinationAccountIdentifier) : candidate.counterparty ?? ''})`.trim(),
                    };
                }
            } else if (evidence.feeAmount > 0) {
                // E.g. CBE debit with service charge, VAT, and disaster recovery where destination is not explicitly named in the message text
                return {
                    status: 'OWN_ACCOUNT_CANDIDATE',
                    isOwnAccountTransfer: true,
                    sourceWalletId: sourceWallet?.id,
                    sourceAccount: sourceAccount ?? undefined,
                    principalAmount: evidence.principalAmount,
                    feeAmount: evidence.feeAmount,
                    totalDebitAmount: evidence.totalDebitAmount,
                    destinationCreditAmount: evidence.principalAmount,
                    sourceReference: candidate.reference,
                    reconciledSourceBalance: candidate.currentBalance,
                    reason: `Debit from ${sourceWallet?.name ?? 'account'} with ETB ${evidence.feeAmount} transfer charges`,
                };
            }
        }
    }

    return {
        status: 'STANDALONE',
        isOwnAccountTransfer: false,
        principalAmount: candidate.principalAmount,
        feeAmount: candidate.fees?.totalFees ?? 0,
        totalDebitAmount: candidate.ledgerAmount,
        destinationCreditAmount: candidate.principalAmount,
        reason: 'Standard non-transfer transaction',
    };
}
