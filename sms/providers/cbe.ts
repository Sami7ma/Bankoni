import { parseCbeMoney as parseSantim } from '../../utils/money';
import { readCbeEventDate } from '../cbeEventTime';
// sms/providers/cbe.ts
// Parser implementation for Commercial Bank of Ethiopia (CBE) SMS messages.
// Pure TypeScript domain logic.

import {
    normalizeSmsText,
    santimToEtb,
    formatSantim,
    extractAccountLast4,
    parseEthiopianDateTime,
} from '../cleaners';
import type { ParsedTransactionCandidate, SmsParseResult, FeeBreakdown } from '../types';

/**
 * Extracts reference from CBE receipt or branch receipt URLs if present.
 * Examples:
 *   "https://apps.cbe.com.et:100/?id=FT2412345678" -> "FT2412345678"
 *   "https://apps.cbe.com.et/Receipt/CBE12345"     -> "CBE12345"
 *   "https://cbe.et/r/FT98765"                     -> "FT98765"
 */
function extractCbeReference(text: string): string | undefined {
    // Only receipt identities on the bank's established hosts, never a feedback URL.
    const receipts=[...text.matchAll(/https?:\/\/[^\s]+/gi)].map(m=>m[0]).filter(url=>! /\/(?:feedback|survey|fb)(?:[/?#]|$)/i.test(url) && /^https?:\/\/(?:apps\.cbe\.com\.et(?::\d+)?|mbreciept\.cbe\.com\.et|cbe\.et)(?:\/|$)/i.test(url));
    for(const url of receipts) {
        const ref=/[?&]id=([A-Za-z0-9_-]+)/i.exec(url)?.[1]
          ?? /\/(?:BranchReceipt|Receipt)\/([A-Za-z0-9_-]+)/i.exec(url)?.[1]
          ?? /^https?:\/\/mbreciept\.cbe\.com\.et\/(v2-[A-Za-z0-9_-]+)/i.exec(url)?.[1];
        if(ref)return ref;
    }
    const withoutUrls=text.replace(/https?:\/\/[^\s]+/gi,'');
    return /\b(?:txn\s*(?:id|no)?|ref(?:\s*no)?|reference)\s*[:=\s]\s*(?:is\s+)?([A-Za-z0-9]+)\b/i.exec(withoutUrls)?.[1]
      ?? /\bid\s*=\s*((?:FT|CBE)[A-Za-z0-9]+)/i.exec(withoutUrls)?.[1]
      ?? /\b(FT[0-9A-Z]{6,})\b/i.exec(withoutUrls)?.[1];
}

/**
 * Helper to extract fees and validate arithmetic from CBE fee strings.
 */
function extractCbeFees(
    text: string,
    principalSantim: number
): {
    feeBreakdown?: FeeBreakdown;
    ledgerSantim: number;
    isDerived: boolean;
    error?: string;
} {
    const scMatch = text.match(/(?:Service\s+charge|S\.charge|service\s+charge|s\.charge)\s+of\s+ETB\s*([\d,.]+)/i);
    const vatMatch = text.match(/(?:and\s+)?(?:VAT\s*(?:\(15%\))?|15%\s+VAT)\s+of\s+(?:ETB\s*)?([\d,.]+)/i);
    const disasterMatch = text.match(/(?:and\s+)?(?:Disaster\s+Recovery|Disaster\s+Fund)\s*(?:\(5%\))?\s+of\s+(?:ETB\s*)?([\d,.]+)/i);
    const totalMatch = text.match(/(?:with\s+)?(?:a\s+)?total\s+of\s+ETB\s*([\d,.]+)/i);

    const groups: [RegExp, RegExpMatchArray | null][] = [
        [/\b(?:service\s+charge|s\.charge)\b/gi,scMatch],
        [/\bVAT\b/gi,vatMatch], [/\bDisaster\s+(?:Recovery|Fund)\b/gi,disasterMatch],
        [/\btotal\s+of\b/gi,totalMatch],
    ];
    if (groups.some(([label,match]) => { const count=[...text.matchAll(label)].length; return count>1 || (count===1 && (!match || parseSantim(match[1].replace(/,$/,''))==null)); })
        || /\b(?:other\s+fees?|service\s+fee|commission|charges?|tax)\b/i.test(text.replace(/(?:service\s+charge|s\.charge)/gi,''))) {
        return {ledgerSantim:0,isDerived:false,error:'Incomplete, repeated or unsupported CBE charge/total clause.'};
    }

    const scSantim = scMatch ? parseSantim(scMatch[1].replace(/,$/,'')) ?? 0 : 0;
    const vatSantim = vatMatch ? parseSantim(vatMatch[1].replace(/,$/,'')) ?? 0 : 0;
    const disasterSantim = disasterMatch ? parseSantim(disasterMatch[1].replace(/,$/,'')) ?? 0 : 0;
    const statedTotalSantim = totalMatch ? parseSantim(totalMatch[1]) : null;

    const totalFeesSantim = scSantim + vatSantim + disasterSantim;
    const hasAnyFees = totalFeesSantim > 0;

    let feeBreakdown: FeeBreakdown | undefined = undefined;
    if (hasAnyFees) {
        feeBreakdown = {
            serviceCharge: scSantim > 0 ? santimToEtb(scSantim) : undefined,
            vat: vatSantim > 0 ? santimToEtb(vatSantim) : undefined,
            disasterFund: disasterSantim > 0 ? santimToEtb(disasterSantim) : undefined,
            totalFees: santimToEtb(totalFeesSantim),
        };
    }

    const calculatedTotalSantim = principalSantim + totalFeesSantim;

    if (statedTotalSantim != null) {
        // Exact santim: all supported stated components already have at most two decimals.
        if (calculatedTotalSantim !== statedTotalSantim) {
            return {
                ledgerSantim: statedTotalSantim,
                isDerived: false,
                error: `CBE fee arithmetic mismatch: Principal (${formatSantim(principalSantim)}) + Fees (${formatSantim(totalFeesSantim)}) does not match stated total (${formatSantim(statedTotalSantim)}).`,
            };
        }
        return {
            feeBreakdown,
            ledgerSantim: statedTotalSantim,
            isDerived: false,
        };
    }

    if (hasAnyFees) {
        return {
            feeBreakdown,
            ledgerSantim: calculatedTotalSantim,
            isDerived: true,
        };
    }

    return {
        feeBreakdown,
        ledgerSantim: principalSantim,
        isDerived: false,
    };
}

/**
 * Parses CBE SMS messages.
 */
function parseCbeTemplate(rawText: string): SmsParseResult {
    const text = normalizeSmsText(rawText);
    const warnings: string[] = [];

    // --- PATTERN 1: CBE Debit Transaction with Fees ---
    // Example: "Dear Customer, A debit transaction of ETB 1300.0 has occurred on your account 1000****1234. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB1312.00. Your current balance is ETB840,060.64. Thanks for Banking with CBE."
    const debitMatch = text.match(
        /A\s+debit\s+transaction\s+of\s+ETB\s*([^\s]+)\s*(?:has\s+occurred\s+on|occurred\s+on)\s+your\s+account\s+([^\s.]+)/i
    );
    if (debitMatch) {
        const principalSantim = parseSantim(debitMatch[1]);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing CBE debit amount.' };
        }

        const account = debitMatch[2].replace(/[.,]$/, '');
        const balanceMatch = text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;

        const feeResult = extractCbeFees(text, principalSantim);
        if (feeResult.error) {
            return { status: 'ambiguous', reason: feeResult.error };
        }

        const reference = extractCbeReference(text);
        const dateMatch = text.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?))?/i);
        let dateTime: string | undefined = undefined;
        if (dateMatch) {
            dateTime = parseEthiopianDateTime(dateMatch[1] + (dateMatch[2] ? ` ${dateMatch[2]}` : '')) ?? undefined;
        }

        if (!dateTime) {
            warnings.push('Transaction date was not specified in the message. Please review and confirm the date.');
        }

        const candidate: ParsedTransactionCandidate = {
            providerId: 'cbe',
            type: 'DEBIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(feeResult.ledgerSantim),
            isLedgerAmountDerived: feeResult.isDerived,
            fees: feeResult.feeBreakdown,
            currency: 'ETB',
            accountIdentifier: account,
            accountLast4: extractAccountLast4(account),
            reference,
            dateTime,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: 'CBE Debit Transaction',
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // User-supplied older CBE transfer template: date/time precede the source account.
    const olderTransfer=text.match(/You\s+have\s+transfer(?:r)?ed\s+ETB\s*([^\s]+)\s+to\s+(.+?)\s+on\s+\d{1,2}\/\d{1,2}\/\d{4}\s+at\s+\d{1,2}:\d{2}(?::\d{2})?\s+from\s+your\s+account\s+([\d*]+)\.\s*Your\s+account\s+has\s+been\s+debited\s+with\s+a\s+S\.charge/i);
    if(olderTransfer) {
        const principal=parseSantim(olderTransfer[1]);
        if(!principal)return {status:'malformed',reason:'Invalid CBE transfer principal.'};
        const fee=extractCbeFees(text,principal);
        if(fee.error)return {status:'ambiguous',reason:fee.error};
        const balance=text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const minor=balance ? parseSantim(balance[1]):null;
        return {status:'parsed',candidate:{providerId:'cbe',type:'DEBIT',currency:'ETB',principalAmount:santimToEtb(principal),ledgerAmount:santimToEtb(fee.ledgerSantim),isLedgerAmountDerived:fee.isDerived,fees:fee.feeBreakdown,accountIdentifier:olderTransfer[3],accountLast4:extractAccountLast4(olderTransfer[3]),counterparty:olderTransfer[2].trim(),currentBalance:minor==null ? undefined:santimToEtb(minor),reference:extractCbeReference(text),description:`Transfer to ${olderTransfer[2].trim()}`,rawSms:rawText,warnings}};
    }

    // --- PATTERN 2: CBE Successful Transfer with Fees ---
    // Example: "Dear Customer, You have successfully transferred ETB300.00 from account 1000****1234 to account 1000****5678 (ABEBE BIKILA). Service charge of ETB 0.50 and VAT(15%) of ETB0.08 and Disaster Recovery(5%) of 0.03 with total of ETB300.61. Your current balance is ETB5,000.00."
    const transferMatch = text.match(
        /You\s+have\s+(?:successfully\s+)?transfer(?:r)?ed\s+ETB\s*([^\s]+)\s+from\s+account\s+([^\s]+)\s+to\s+account\s+([^\s(]+)(?:\s*\(([^)]+)\))?/i
    );
    if (transferMatch) {
        const principalSantim = parseSantim(transferMatch[1]);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing CBE transfer amount.' };
        }

        const sourceAccount = transferMatch[2].replace(/[.,]$/, '');
        const destAccount = transferMatch[3].replace(/[.,]$/, '');
        const recipient = transferMatch[4]?.trim();

        const balanceMatch = text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;

        const feeResult = extractCbeFees(text, principalSantim);
        if (feeResult.error) {
            return { status: 'ambiguous', reason: feeResult.error };
        }

        const reference = extractCbeReference(text);
        const dateMatch = text.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?))?/i);
        let dateTime: string | undefined = undefined;
        if (dateMatch) {
            dateTime = parseEthiopianDateTime(dateMatch[1] + (dateMatch[2] ? ` ${dateMatch[2]}` : '')) ?? undefined;
        }

        if (!dateTime) {
            warnings.push('Transaction date was not specified in the message. Please review and confirm the date.');
        }

        const counterpartyDesc = recipient
            ? `${recipient} (Acct ${destAccount})`
            : `Account ${destAccount}`;

        const candidate: ParsedTransactionCandidate = {
            providerId: 'cbe',
            type: 'DEBIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(feeResult.ledgerSantim),
            isLedgerAmountDerived: feeResult.isDerived,
            fees: feeResult.feeBreakdown,
            currency: 'ETB',
            accountIdentifier: sourceAccount,
            accountLast4: extractAccountLast4(sourceAccount),
            counterparty: counterpartyDesc,
            destinationAccountLast4: extractAccountLast4(destAccount),
            reference,
            dateTime,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: `Transfer to ${counterpartyDesc}`,
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    // --- PATTERN 3: CBE Credit / Deposit ---
    // Example: "Account 1000****1234 has been credited with ETB 2,500.00. Balance is ETB 10,000.00. id=FT26101234"
    const receivedMatch=text.match(/You\s+have\s+received\s+ETB\s*([^\s]+)\s+from\s+account\s+([\d*]+)\s*\(([^)]+)\)\s+to\s+your\s+account\s+([\d*]+)\.\s*Your\s+current\s+balance\s+is\s+ETB\s*[\d,.]+/i);
    if(receivedMatch) {
        const principal=parseSantim(receivedMatch[1]);
        const balance=text.match(/current\s+balance\s+is\s+ETB\s*([\d,.]+)/i);
        const minor=balance ? parseSantim(balance[1]):null;
        if(!principal || minor==null)return {status:'malformed',reason:'Invalid CBE received principal/balance.'};
        return {status:'parsed',candidate:{providerId:'cbe',type:'CREDIT',currency:'ETB',principalAmount:santimToEtb(principal),ledgerAmount:santimToEtb(principal),isLedgerAmountDerived:false,accountIdentifier:receivedMatch[4],accountLast4:extractAccountLast4(receivedMatch[4]),sourceAccountLast4:extractAccountLast4(receivedMatch[2]),counterparty:receivedMatch[3].trim(),currentBalance:santimToEtb(minor),reference:extractCbeReference(text),description:`CBE Credit from ${receivedMatch[3].trim()}`,rawSms:rawText,warnings}};
    }
    const creditMatch = text.match(
        /(?:Account|Acct|your\s+account)\s+([^\s]+)\s+(?:has\s+been|is)\s+credited\s+(?:with\s+)?ETB\s*([^\s]+)/i
    ) || text.match(
        /You\s+have\s+received\s+ETB\s*([^\s]+)\s+(?:from\s+(.+?)\s+)?(?:in|into|to)\s+(?:your\s+)?account\s+([^\s.]+)/i
    );

    if (creditMatch) {
        if(creditMatch[0].toLowerCase().includes('received'))return {
            status:'ambiguous',reason:'The CBE received-to-account wording has no established complete fixture; it is not eligible for ledger import.',
        };
        let account: string;
        let rawAmount: string;
        let counterparty: string | undefined;

        if (creditMatch[0].toLowerCase().includes('received')) {
            rawAmount = creditMatch[1];
            counterparty = creditMatch[2]?.trim();
            account = creditMatch[3];
        } else {
            account = creditMatch[1];
            rawAmount = creditMatch[2];
            counterparty=text.match(/credited\s+with\s+ETB\s*[^\s]+\s+from\s+(.+?),\s+on\s+/i)?.[1]?.trim();
        }

        account = account.replace(/[.,]$/, '');
        const principalSantim = parseSantim(rawAmount);
        if (!principalSantim || principalSantim <= 0) {
            return { status: 'malformed', reason: 'Invalid or missing CBE credit amount.' };
        }

        const balanceMatch = text.match(/(?:current\s+balance|balance)\s+is\s+ETB\s*([\d,.]+)/i);
        const balanceSantim = balanceMatch ? parseSantim(balanceMatch[1]) : null;
        const reference = extractCbeReference(text);

        const dateMatch = text.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?))?/i);
        let dateTime: string | undefined = undefined;
        if (dateMatch) {
            dateTime = parseEthiopianDateTime(dateMatch[1] + (dateMatch[2] ? ` ${dateMatch[2]}` : '')) ?? undefined;
        }

        if (!dateTime) {
            warnings.push('Transaction date was not specified in the message. Please review and confirm the date.');
        }

        const candidate: ParsedTransactionCandidate = {
            providerId: 'cbe',
            type: 'CREDIT',
            principalAmount: santimToEtb(principalSantim),
            ledgerAmount: santimToEtb(principalSantim),
            isLedgerAmountDerived: false,
            currency: 'ETB',
            accountIdentifier: account,
            accountLast4: extractAccountLast4(account),
            counterparty,
            reference,
            dateTime,
            currentBalance: balanceSantim != null ? santimToEtb(balanceSantim) : undefined,
            description: counterparty ? `CBE Credit from ${counterparty}` : 'CBE Credit Deposit',
            rawSms: rawText,
            warnings,
        };

        return { status: 'parsed', candidate };
    }

    return {
        status: 'ambiguous',
        reason: 'Message matches Commercial Bank of Ethiopia (CBE), but could not find a recognized transaction debit, credit, or transfer structure.',
    };
}


/** CBE-only semantic guard around the established grammatical templates. */
export function parseCbeSms(rawText:string): SmsParseResult {
    const text=normalizeSmsText(rawText);
    const movements=[...text.matchAll(/\b(?:debit\s+transaction\s+of|(?:successfully\s+)?transfer(?:r)?ed\s+ETB|credited\s+(?:with\s+)?ETB|received\s+ETB)/gi)];
    if(movements.length>1 || (/\b(?:debited|debit\s+transaction)\b/i.test(text) && /\b(?:credited|received)\b/i.test(text)))
        return {status:'ambiguous',reason:'Several or contradictory CBE money movements require review.'};
    if(/\b(?:pending|scheduled|requested|unsuccessful|declined|failed)\b/i.test(text))return {status:'ambiguous',reason:'CBE completion is uncertain.'};
    const result=parseCbeTemplate(text);
    if(result.status!=='parsed')return result;
    const candidate=result.candidate;
    if(!candidate.accountLast4 || !/^[0-9*]+$/.test(candidate.accountIdentifier ?? ''))
        return {status:'ambiguous',reason:'A supported CBE account identifier is required.'};
    // Every currency-labelled token must be a complete supported amount; no prefix matches.
    for(const token of text.matchAll(/\bETB\s*([^\s]+)/gi)) {
        if(parseSantim(token[1].replace(/,$/,''))==null)return {status:'malformed',reason:'Invalid CBE monetary token or separators.'};
    }
    const knownMoneyClauses=[
        /\bdebit\s+transaction\s+of\s+ETB\s*[^\s]+/gi,
        /\btransfer(?:r)?ed\s+ETB\s*[^\s]+/gi,
        /\bcredited\s+(?:with\s+)?ETB\s*[^\s]+/gi,
        /\breceived\s+ETB\s*[^\s]+/gi,
        /\b(?:service\s+charge|s\.charge)\s+of\s+ETB\s*[^\s]+/gi,
        /\b(?:VAT\s*(?:\(15%\))?|15%\s+VAT)\s+of\s+(?:ETB\s*)?[^\s]+/gi,
        /\bDisaster\s+(?:Recovery|Fund)\s*(?:\(5%\))?\s+of\s+(?:ETB\s*)?[^\s]+/gi,
        /\btotal\s+of\s+ETB\s*[^\s]+/gi,
        /\b(?:current\s+balance|balance)\s+is\s+ETB\s*[^\s]+/gi,
    ];
    const remainder=knownMoneyClauses.reduce((remaining,pattern)=>remaining.replace(pattern,''),text);
    if(/\b(?:ETB|USD|EUR|KES|Birr)/i.test(remainder) || [...text.matchAll(/\bbalance\s+is\s+ETB/gi)].length>1)
        return {status:'ambiguous',reason:'An additional CBE amount, currency or balance clause is not established.'};
    if(candidate.type==='CREDIT' && /\b(?:service\s+charge|VAT|Disaster|fee|total\s+of)\b/i.test(text))
        return {status:'ambiguous',reason:'Charges on this CBE credit template are not established.'};
    const date=readCbeEventDate(text);
    candidate.dateTime=date.state==='valid' ? date.iso : undefined;
    candidate.warnings=candidate.warnings.filter(w=>!/date/i.test(w));
    if(date.state==='invalid')candidate.warnings.push(date.reason);
    if(date.state==='absent')candidate.warnings.push('No event date supplied; original SMS receive time is the labelled fallback.');
    return result;
}
