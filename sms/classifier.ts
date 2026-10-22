// sms/classifier.ts
// Classifies whether an SMS message is a non-ledger event (OTP, authorization, airtime receipt, etc.)
// Pure TypeScript domain logic.

export interface ClassificationResult {
    isNonTransaction: boolean;
    reason?: string;
    messageType?: 'otp' | 'atm_authorization' | 'airtime_receipt' | 'promotional' | 'failed_transaction';
}

const ATM_AUTHORIZATION_REGEX = /\bATM\s+withdraw(?:al)?\s+secret\s+code\s+is\s+(\d{4,8})\b/i;

const AIRTIME_RECEIPT_PATTERNS = [
    /you\s+have\s+received\s+ETB\s+[\d,.]+\s+airtime\s+from\s+/i,
    /[\d,.]+\s*ብር[\s\S]*?ተሞልቶሎታል/i,
    /airtime\s+recharge\s+successful/i,
];

const OTP_PATTERNS = [
    /\b(?:OTP|verification code|security code|PIN)\s+is\s*[:\s]?\s*([0-9]{4,8})\b/i,
    /\bcode\s+is\s*([0-9]{4,8})\b/i,
    /\bDo not share this code\b/i,
    /\buse this code to log in\b/i,
];

const FAILED_PATTERNS = [
    /\btransaction\s+(?:has\s+)?failed\b/i,
    /\btransaction\s+was\s+unsuccessful\b/i,
    /\binsufficient\s+balance\b/i,
    /\bpayment\s+declined\b/i,
];

const PROMOTIONAL_PATTERNS = [
    /\bdiscount\s+offer\b/i,
    /\bwin\s+prizes?\b/i,
    /\bcongratulations!?\s+you\s+(?:have\s+)?won\b/i,
    /\bdownload\s+(?:the\s+)?(?:new\s+)?app\b/i,
    /\bspecial\s+promotion\b/i,
];

/**
 * Checks whether an incoming message represents a non-ledger notification
 * that must not be imported as a financial transaction.
 */
export function classifyMessage(text: string): ClassificationResult {
    // 1. Telebirr ATM authorization code (money has not moved yet)
    if (ATM_AUTHORIZATION_REGEX.test(text)) {
        return {
            isNonTransaction: true,
            messageType: 'atm_authorization',
            reason: 'ATM withdrawal authorization code. Money has not left your account until the cash is dispensed.',
        };
    }

    // 2. Airtime receipts (delivers phone airtime, not wallet cash)
    for (const pattern of AIRTIME_RECEIPT_PATTERNS) {
        if (pattern.test(text)) {
            return {
                isNonTransaction: true,
                messageType: 'airtime_receipt',
                reason: 'Airtime delivery receipt. This represents phone credit recharge, not a cash deposit to your wallet.',
            };
        }
    }

    // 3. OTPs & security codes
    for (const pattern of OTP_PATTERNS) {
        if (pattern.test(text)) {
            return {
                isNonTransaction: true,
                messageType: 'otp',
                reason: 'Security verification code or OTP. This is not a financial transaction.',
            };
        }
    }

    // 4. Explicitly failed transactions
    for (const pattern of FAILED_PATTERNS) {
        if (pattern.test(text)) {
            return {
                isNonTransaction: true,
                messageType: 'failed_transaction',
                reason: 'Failed or declined transaction. No balance changes were completed.',
            };
        }
    }

    // 5. Promotional messages (unless they contain an explicit transaction debit/credit)
    for (const pattern of PROMOTIONAL_PATTERNS) {
        if (pattern.test(text) && !text.includes('Current balance') && !text.includes('credited with') && !text.includes('debited with')) {
            return {
                isNonTransaction: true,
                messageType: 'promotional',
                reason: 'Promotional announcement or marketing message.',
            };
        }
    }

    return { isNonTransaction: false };
}
