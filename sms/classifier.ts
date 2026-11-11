// sms/classifier.ts
// Classifies whether an SMS message is a non-ledger event (OTP, authorization, airtime receipt, etc.)
// Pure TypeScript domain logic.

export interface ClassificationResult {
    isNonTransaction: boolean;
    reason?: string;
    messageType?: 'otp' | 'atm_authorization' | 'airtime_receipt' | 'promotional' | 'failed_transaction' | 'security_alert' | 'balance_only';
}

const ATM_AUTHORIZATION_REGEX = /\bATM\s+withdraw(?:al)?\s+secret\s+code\s+is\s+(\d{4,8})\b/i;

const AIRTIME_RECEIPT_PATTERNS = [
    /you\s+(?:have\s+)?received\s+(?:ETB\s*)?[\d,.]+\s*(?:Br\.?|Birr|ETB)?\s*airtime\s+from\s+/i,
    /[\d,.]+\s*ብር[\s\S]*?ተሞልቶሎታል/i,
    /airtime\s+recharge\s+successful/i,
    /\breceived\s+[\d,.]+\s*(?:Br\.?|Birr|ETB)?\s*airtime\b/i,
    /\bairtime\s+from\b/i,
];

const OTP_PATTERNS = [
    /\b(?:pin|passcode|password|verification\s+code|security\s+code)\s*(?:(?:is|[:=-])\s*)?\d{4,8}\b/i,
    /\b(?:OTP|verification code|security code|PIN)\s+is\s*[:\s]?\s*([0-9]{4,8})\b/i,
    /\bcode\s+is\s*([0-9]{4,8})\b/i,
    /\bDo not share this code\b/i,
    /\buse this code to log in\b/i,
];

const FAILED_PATTERNS = [
    /\b(?:transaction|payment|transfer|withdrawal)\b[^.]{0,120}\b(?:declined|failed|rejected|unsuccessful)\b/i,
    /\b(?:transaction|payment|transfer|withdrawal)\s+(?:(?:has\s+been|was|is)\s+)?(?:failed|declined|rejected|pending|unsuccessful)\b/i,
    /\binsufficient\s+(?:funds|balance)\b/i,
    /\btransaction\s+(?:has\s+)?failed\b/i,
    /\btransaction\s+was\s+unsuccessful\b/i,
    /\binsufficient\s+balance\b/i,
    /\bpayment\s+declined\b/i,
];

const PROMOTIONAL_PATTERNS = [
    /\bdiscount\s+offer\b/i,
    /\bwin\s+prizes?\b/i,
    /\bcongratulations!?\s+you\s+(?:have\s+)?won\b/i,
    /\bdownload\s+(?:the\s+)?(?:new\s+)?(?:cbe\s*birr\s+)?app\b/i,
    /\bspecial\s+promotion\b/i,
    /\bplay\.google\.com\/store\/apps\b/i,
    /\bapps\.apple\.com\b/i,
    /\bexperience\s+(?:our\s+)?(?:new\s+)?cbe\s*birr\b/i,
];

/**
 * Checks whether an incoming message represents a non-ledger notification
 * that must not be imported as a financial transaction.
 */
export function classifyMessage(text: string): ClassificationResult {
    if (/\b(?:login\s+(?:alert|attempt|code)|new\s+device|password\s+(?:changed|reset)|security\s+alert|authentication\s+code|one[ -]time\s+(?:password|code))\b/i.test(text)) {
        return { isNonTransaction: true, messageType: 'security_alert', reason: 'Authentication or security notification; no confirmed money movement.' };
    }
    if (/\bOTP\d*\b/i.test(text)) return { isNonTransaction: true, messageType: 'otp', reason: 'One-time authentication code; not a financial transaction.' };
    if (/\bbalance\b/i.test(text) && !/\b(?:credited|debited|received|paid|transferred|withdrawn|withdrawal|deposited|deposit|bought|purchased|refund(?:ed)?|revers(?:al|ed)|debit\s+transaction|credit\s+transaction)\b/i.test(text)) {
        return { isNonTransaction: true, messageType: 'balance_only', reason: 'Balance information is reconciliation evidence, not a transaction.' };
    }
    // 1. Telebirr ATM withdrawal authorization code (money has not moved yet)
    if (ATM_AUTHORIZATION_REGEX.test(text)) {
        return {
            isNonTransaction: true,
            messageType: 'atm_authorization',
            reason: 'ATM withdrawal authorization code. Money has not left your account until the cash is dispensed.',
        };
    }

    // 2. Airtime receipts (delivers phone airtime, not financial wallet cash)
    for (const pattern of AIRTIME_RECEIPT_PATTERNS) {
        if (pattern.test(text)) {
            return {
                isNonTransaction: true,
                messageType: 'airtime_receipt',
                reason: 'Airtime delivery receipt. This represents phone credit recharge, not a cash deposit to your financial wallet.',
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

    // 5. Promotional messages (unless they represent a transaction or cashback)
    const isCashback = /\bcashback\b/i.test(text);
    if (!isCashback) {
        for (const pattern of PROMOTIONAL_PATTERNS) {
            if (
                pattern.test(text) &&
                !text.includes('credited with') &&
                !text.includes('debited with') &&
                !/\byou\s+have\s+(?:paid|received|transferred|bought)\b/i.test(text)
            ) {
                return {
                    isNonTransaction: true,
                    messageType: 'promotional',
                    reason: 'Promotional announcement or marketing message.',
                };
            }
        }
    }

    return { isNonTransaction: false };
}
