# BanKoni SMS Transaction Import & Parsing: Engineering & Architecture Guide

This document is a comprehensive engineering guide to the **SMS Transaction Parsing and Import** feature in BanKoni (ባንኮni). It is written for software engineering students, contributors, and maintainers who want to understand every layer of the system: from pure string parsing and monetary mathematics to SQLite transactional persistence and React Native UI reconciliation.

---

## A. Architecture Overview

The SMS parsing system in BanKoni is designed around the **Local-First Separation of Concerns** principle:
1. **Pure Domain Parser (`sms/`)**: 100% standalone, pure TypeScript modules. It has **no dependencies** on React Native, Expo, Zustand, or SQLite. It takes raw text in and outputs typed candidate transactions or specific rejection errors.
2. **Reconciliation & Matcher Layer (`sms/matcher.ts`, `sms/fingerprint.ts`)**: Pure domain functions that match candidates against the user's active wallets and compute deterministic SHA-256 fingerprints for duplicate detection.
3. **Database Layer (`db/database.ts`)**: Manages SQLite schema migrations (additive columns and partial unique indexes), verifies foreign keys and trigger invariants, performs atomic balance updates inside exclusive transactions, and stores transaction records with source provenance (`'sms'`).
4. **Application State Layer (`store/useBanKoniStore.ts`)**: Thin orchestrator that triggers database writes and immediately reloads fresh snapshots of transactions and wallets into Zustand, ensuring SQLite remains the single source of truth.
5. **UI Layer (`components/modals/SmsImportModal.tsx`, `app/(app)/TransactionScreen.tsx`)**: User-controlled modal that guides the user through the **Paste SMS → Parse → Review → Reconcile → Import** flow.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION LAYER                              │
│  TransactionScreen.tsx  ──►  SmsImportModal.tsx (Paste & Review Form)  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        PURE DOMAIN PARSER (sms/)                       │
│  normalizeSmsText ──► classifyMessage ──► detectProvider               │
│                                                │                       │
│         ┌───────────┬───────────┬──────────────┼───────────┬─────────┐ │
│         ▼           ▼           ▼              ▼           ▼         ▼ │
│       parseCbe  parseDashen parseTelebirr  parseMpesa  parseAwash parseBoa
│                                                │                       │
│                                                ▼ (cbe_birr non_txn)    │
│                                         SmsParseResult                 │
│                                     (Discriminated Union)              │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        RECONCILIATION & DEDUPLICATION                  │
│       matchWalletForCandidate()  │   generateSmsFingerprint()          │
│       checkSmsDuplicateDB()      │   Category flow guard               │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ User Confirms
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        PERSISTENCE & STATE LAYER                       │
│  useBanKoniStore.addTransaction() ──► withExclusiveTransaction(db)     │
│                                         ├── Duplicate constraint check │
│                                         ├── INSERT INTO transactions   │
│                                         └── UPDATE wallets SET balance │
│                                              │                         │
│  Zustand store reloads from SQLite ◄─────────┴─────────────────────────┤
│  UI reflects updated balance & transactions                            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## B. File-by-File Changes

### Domain Files (`sms/`)

1. **[`sms/types.ts`](file:///home/Sami/Documents/MoniVO-/sms/types.ts)**:
   - *Category*: Domain Model.
   - *Why it exists*: Defines the TypeScript contracts for provider IDs, parsed candidate transactions, fee breakdowns, and the `SmsParseResult` discriminated union.
   - *Phase 2 update*: Extended `SmsProviderId` to include `'mpesa'`, `'awash'`, `'boa'`, and `'cbe_birr'`.

2. **[`sms/cleaners.ts`](file:///home/Sami/Documents/MoniVO-/sms/cleaners.ts)**:
   - *Category*: Pure Domain Utility.
   - *Why it exists*: Handles text normalization (zero-width spaces, non-breaking spaces, CRLF), exact decimal parsing into integer santim (1 ETB = 100 santim), formatting, account masking/suffix extraction, and Ethiopian timezone (`+03:00`) ISO date parsing.
   - *Phase 2 update*: Added `expandTwoDigitYear()` (2000-century pivot) and extended `parseEthiopianDateTime()` to support 2-digit years (`21/10/26 at 12:37 PM`, `09/04/26 14:36`, `21/10/26`), timestamps with optional seconds, and Awash ISO format (`2026-10-14 08:32:28`). Added strict calendar boundary checks.

3. **[`sms/classifier.ts`](file:///home/Sami/Documents/MoniVO-/sms/classifier.ts)**:
   - *Category*: Pure Domain Classifier.
   - *Why it exists*: Filters out non-ledger events before regex matching begins: OTP verification codes, ATM withdrawal authorization secrets, airtime receipts, promotional texts, and declined transactions.
   - *Phase 2 update*: Added classification rules for CBE Birr received airtime (`you received ... airtime from`), CBE Birr app-store promotional announcements, and explicitly guarded M-PESA cashback messages from false promotional classification.

4. **[`sms/fingerprint.ts`](file:///home/Sami/Documents/MoniVO-/sms/fingerprint.ts)**:
   - *Category*: Cryptographic Deduplication Utility.
   - *Why it exists*: Generates a deterministic SHA-256 hash (64 hex characters) from normalized transaction fields (`providerId`, `type`, `ledgerAmount`, `accountLast4`, `dateTime`, `counterparty`). Implemented as a zero-dependency pure TypeScript SHA-256 algorithm to guarantee identical execution across Node.js, Jest, and mobile runtimes (Hermes / JSC).

5. **[`sms/providers/detector.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/detector.ts)**:
   - *Category*: Domain Routing.
   - *Why it exists*: Identifies which provider owns the SMS using a two-pass detection algorithm.
   - *Phase 2 update*: Added detection signatures for M-PESA (`M-PESA`, `Safaricom bundle`), Awash Bank (`Awash Bank`), Bank of Abyssinia (`Bank of Abyssinia`, `bankofabyssinia.com`), and CBE Birr (`CBE Birr`). Evaluates institutional sign-offs first to guarantee that Awash Bank credits with `via IPS DASHEN BANK` or M-PESA credits with `Commercial Bank Of Ethiopia-B2C` route to their true account institution rather than incidental counterparty banks.

6. **[`sms/providers/cbe.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/cbe.ts)**:
   - *Category*: Provider-Specific Parser (CBE).
   - *Why it exists*: Parses Commercial Bank of Ethiopia debit transactions with fee breakdowns, outgoing transfers, and incoming credits.

7. **[`sms/providers/dashen.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/dashen.ts)**:
   - *Category*: Provider-Specific Parser (Dashen Bank).
   - *Why it exists*: Parses Dashen Bank incoming credit transactions with 12-hour AM/PM time and outgoing debit transactions.

8. **[`sms/providers/telebirr.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/telebirr.ts)**:
   - *Category*: Provider-Specific Parser (Telebirr).
   - *Why it exists*: Parses Telebirr outgoing transfers with derived fees and dual references, incoming deposits, package purchases, and general payments.

9. **[`sms/providers/mpesa.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/mpesa.ts)** *(New in Phase 2)*:
   - *Category*: Provider-Specific Parser (M-PESA Ethiopia / Safaricom).
   - *Why it exists*: Parses M-PESA Ethiopia SMS messages:
     - Pattern 1: Incoming transfer (`CREDIT`) with counterparty (e.g. CBE-B2C), 2-digit year timestamp (`21/10/26 at 12:37 PM`), transaction number, and wallet balance.
     - Pattern 2: Safaricom bundle purchase (`DEBIT`) with beneficiary phone number, transaction reference, timestamp, and wallet balance.
     - Pattern 3: M-PESA cashback (`CREDIT`) with warnings for missing date and reference, requiring user confirmation.

10. **[`sms/providers/awash.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/awash.ts)** *(New in Phase 2)*:
    - *Category*: Provider-Specific Parser (Awash Bank).
    - *Why it exists*: Parses Awash Bank incoming credit notifications (`CREDIT`):
      - Extracts masked account (and last 4 digits), credited amount, ISO timestamp (`2026-10-14 08:32:28`), counterparty, and current balance.
      - Flags missing transaction reference with warning for user review.
      - Explicitly rejects unconfirmed outgoing debit formats as malformed/unsupported to prevent guesswork.

11. **[`sms/providers/boa.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/boa.ts)** *(New in Phase 2)*:
    - *Category*: Provider-Specific Parser (Bank of Abyssinia).
    - *Why it exists*: Parses Bank of Abyssinia messages:
      - Confirmed Debit Pattern (`DEBIT`): Extracts ledger debit amount, masked account (last 4), available balance, and precisely targets `/slip/?trx=...` receipt URL reference while strictly ignoring feedback survey `/cs/?trx=...` IDs and Fayda links. Flags missing date for manual user confirmation.
      - Provisional Reconstructed Credit Pattern: Isolated, clearly marked candidate parser for partial credit screenshots, flagging warnings for manual review.

12. **[`sms/matcher.ts`](file:///home/Sami/Documents/MoniVO-/sms/matcher.ts)**:
    - *Category*: Domain Wallet Matching.
    - *Why it exists*: Matches candidate transactions against user wallets (`exact_account`, `provider_only`, `ambiguous`, `none`).

13. **[`sms/index.ts`](file:///home/Sami/Documents/MoniVO-/sms/index.ts)**:
    - *Category*: Public Domain Entry Point.
    - *Why it exists*: Orchestrates `normalizeSmsText` $\rightarrow$ `classifyMessage` $\rightarrow$ `detectProvider` $\rightarrow$ provider parser.
    - *Phase 2 update*: Routes to `mpesa`, `awash`, and `boa`, and treats `cbe_birr` explicitly as non-transaction.

### Modified Application & UI Files

14. **[`types/Transaction.ts`](file:///home/Sami/Documents/MoniVO-/types/Transaction.ts)**:
    - Optional fields: `source?: 'manual' | 'sms'`, `smsReference?: string`, `smsFingerprint?: string`.

15. **[`constants/walletProviders.ts`](file:///home/Sami/Documents/MoniVO-/constants/walletProviders.ts)**:
    - Pre-existing canonical wallet provider IDs: `'cbe'`, `'dashen'`, `'telebirr'`, `'mpesa'`, `'cbe_birr'`, `'boa'`, `'awash'`.

16. **[`db/database.ts`](file:///home/Sami/Documents/MoniVO-/db/database.ts)**:
    - SQLite repository: `sms_reference` and `sms_fingerprint` additive columns, partial unique indexes, atomic balance updates, and `checkSmsDuplicateDB()`.

17. **[`components/modals/SmsImportModal.tsx`](file:///home/Sami/Documents/MoniVO-/components/modals/SmsImportModal.tsx)**:
    - *Phase 2 update*: Added `mpesa`, `awash`, and `boa` to manual provider dropdown options and title formatters. When a candidate lacks an explicit date (such as M-PESA cashback or BOA debit), the date input displays `"Date (Manual/Current):"` and user confirmation is required.

18. **[`.gitignore`](file:///home/Sami/Documents/MoniVO-/.gitignore)**:
    - Protects user privacy by ignoring `.private-sms-samples/` and `.tests/`.

---

## C. Complete Flow of Data

```
1. USER ACTION: User pastes SMS text into SmsImportModal and taps "Parse SMS".
   │
   ▼
2. parseSms(rawText, preferredProvider) [sms/index.ts]
   ├── normalizeSmsText(rawText): strips zero-width chars, trims, standardizes CRLF.
   ├── classifyMessage(text): rejects OTPs, secret codes, promotional texts.
   ├── detectProvider(text): matches CBE, Dashen, or Telebirr via strong/weak signatures.
   └── Routes to parseCbeSms / parseDashenSms / parseTelebirrSms.
   │
   ▼
3. CANDIDATE EXTRACTION & VALIDATION [sms/providers/*.ts]
   ├── Named regex captures amounts, accounts, dates, references, fees, and balance.
   ├── parseSantim(): converts "ETB 1,300.00" to exact integer santim (130000).
   ├── Fee arithmetic validation: checks if principal + fees == stated total.
   └── Output: { status: 'parsed', candidate: ParsedTransactionCandidate }.
   │
   ▼
4. WALLET MATCHING & RECONCILIATION [sms/matcher.ts, sms/fingerprint.ts]
   ├── matchWalletForCandidate(candidate, wallets):
   │     • exact_account: matches provider AND last 4 digits.
   │     • provider_only: only 1 wallet exists for provider.
   │     • ambiguous: multiple wallets exist; requires user selection.
   │     • none: user must select or create a wallet.
   ├── generateSmsFingerprint(candidate): computes SHA-256 hash of normalized fields.
   └── checkSmsDuplicateDB(ref, fingerprint): checks SQLite for existing duplicates.
   │
   ▼
5. USER REVIEW [components/modals/SmsImportModal.tsx]
   ├── Card displays ledger amount, fee breakdown, counterparty, account suffix, balance.
   ├── User confirms target Wallet and selects Category (filtered strictly by flow).
   ├── User confirms Date (pre-filled or defaults to current time if absent from SMS).
   └── User explicitly clicks "Confirm & Import".
   │
   ▼
6. PERSISTENCE & BALANCE RECONCILIATION [store/useBanKoniStore.ts -> db/database.ts]
   ├── addTransaction() in Zustand store calls insertTransactionDB().
   ├── withExclusiveTransaction() opens atomic transaction in SQLite:
   │     ├── assertTransactionReferences(): verifies wallet exists & category flow matches.
   │     ├── Duplicate checks: rejects if smsReference or smsFingerprint exists.
   │     ├── INSERT INTO transactions: stores record with source='sms'. (raw_sms is NULL).
   │     └── UPDATE wallets SET balance = balance + delta: atomic balance reconciliation.
   │
   ▼
7. STATE RELOAD & UI UPDATE
   ├── readTransactionsAndWallets(): reloads fresh rows from SQLite.
   ├── Zustand store updates { transactions, wallets }.
   ├── Modal displays success message, wipes sensitive raw SMS from memory, and closes.
   └── TransactionScreen & Wallet cards immediately display the new transaction and updated balance.
```

---

## D. Explain Every Boundary

### 1. What the Parser Does and Does Not Do
- **The parser DOES**: Extract string values, normalize text, parse dates into ISO formats, convert strings to integer santim, validate that fee mathematics adds up, and return structured candidates.
- **The parser DOES NOT**:
  - Connect to a database or alter any state.
  - Assume a transaction is legitimate just because the text says so.
  - Authenticate the SMS sender.
  - Automatically import or create transactions.
  - Invent missing data (dates, fees, accounts, categories).

### 2. Message Authenticity, Spoofing, and Money Movement
An incoming SMS is plain text. Any app or user could type or paste a fabricated string that mimics CBE or Telebirr. Furthermore, SMS sender IDs can be spoofed on telecommunication networks. Therefore:
- An SMS parse **never proves money actually moved**.
- An SMS parse is **only a draft candidate** to save user data-entry effort.
- The human user is the final authority who verifies their banking reality before pressing "Confirm & Import".

### 3. Separation of Parser, Review, Duplicate Detection, and Persistence
- **Parser**: Must remain pure and deterministic so it can be tested in isolation with 100% test coverage without needing a database or UI runtime.
- **Review**: Financial correctness requires human confirmation. The UI must present the *real ledger impact* (principal + fees) rather than silently writing to the database.
- **Duplicate Checking**: Exists at two stages:
  1. *Soft check in UI*: Warns the user immediately before confirmation.
  2. *Hard check in SQLite*: Enforced inside `withExclusiveTransaction()` via unique partial indexes to prevent race conditions or double-taps.
- **Persistence**: Belongs exclusively to the SQLite repository layer to protect balance invariants and trigger consistency.

---

## E. Financial Calculations: Step-by-Step

### 1. Integer Santim Monetary Representation
JavaScript `number` is a 64-bit IEEE 754 floating-point type. Simple operations like `0.1 + 0.2` yield `0.30000000000000004`. In banking, using floating-point math directly causes fractional cent errors that fail equality checks.

To avoid this, `sms/cleaners.ts` parses amounts using string decomposition into integer **santim** (1 ETB = 100 santim):
$$\text{santim} = (\text{integerPart} \times 100) + \text{fractionPart}$$
All comparisons, additions, and fee validations are performed on integers:
- `1300.00` ETB $\rightarrow$ `130000` santim
- `10.00` ETB $\rightarrow$ `1000` santim
- `1.50` ETB $\rightarrow$ `150` santim
- `0.50` ETB $\rightarrow$ `50` santim

Only when returning the final candidate or persisting to SQLite (which uses `REAL`) is the amount converted back via `santim / 100`.

### 2. Example 1: CBE Debit Transaction with Fees
Message:
> *"Dear Customer, A debit transaction of ETB 1300.0 has occurred on your account 1000****1234. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB1312.00. Your current balance is ETB840,060.64."*

**Calculation**:
- Principal: $1,300.00$ ETB ($130,000$ santim)
- Service Charge: $10.00$ ETB ($1,000$ santim)
- VAT (15%): $1.50$ ETB ($150$ santim)
- Disaster Recovery (5%): $0.50$ ETB ($50$ santim)
- Stated Total: $1,312.00$ ETB ($131,200$ santim)

**Validation**:
$$130,000 + 1,000 + 150 + 50 = 131,200 \text{ santim} \equiv \text{Stated Total}$$
- **Principal Amount**: `1300.00`
- **Ledger Amount** (amount deducted from wallet): `1312.00`
- **Post-Transaction Balance**: `840060.64`

### 3. Example 2: Telebirr Outgoing Bank Transfer with Derived Fees
Message:
> *"Dear Customer, You have transferred ETB 1,000.00 successfully from your telebirr account 09****1234 to Commercial Bank of Ethiopia account number 1000****5678... The service fee is ETB 5.22 and 15% VAT on the service fee is ETB 0.78. Your current balance is ETB 383.83."*

**Calculation**:
- Principal: $1,000.00$ ETB ($100,000$ santim)
- Service Fee: $5.22$ ETB ($522$ santim)
- VAT (15%): $0.78$ ETB ($78$ santim)
- Stated Total in message: None provided.

**Derivation**:
$$\text{Total Fees} = 522 + 78 = 600 \text{ santim } (6.00 \text{ ETB})$$
$$\text{Ledger Amount} = 100,000 + 600 = 100,600 \text{ santim } (1,006.00 \text{ ETB})$$
- **Principal Amount**: `1000.00`
- **Ledger Amount** (derived): `1006.00` (`isLedgerAmountDerived: true`)
- **Post-Transaction Balance**: `383.83`

---

## F. TypeScript and Regular Expressions

### 1. Discriminated Union Result Type
The parser returns an `SmsParseResult` discriminated union. Code calling `parseSms()` uses TypeScript type narrowing on `result.status`:

```typescript
export type SmsParseResult =
    | { status: 'parsed'; candidate: ParsedTransactionCandidate }
    | { status: 'unsupported_provider'; reason: string }
    | { status: 'non_transaction'; reason: string; messageType?: string }
    | { status: 'ambiguous'; reason: string; details?: Record<string, unknown> }
    | { status: 'malformed'; reason: string };
```

If `result.status !== 'parsed'`, TypeScript prevents accessing `result.candidate`.

### 2. Regular Expressions & Capture Groups
The parser uses standard, robust regexes without brittle flags. Examples:
- **Telebirr Outgoing Transfer**:
  ```typescript
  /You\s+have\s+transferred\s+ETB\s*([\d,.]+)\s+successfully\s+from\s+your\s+telebirr\s+account\s+([^\s]+)\s+to\s+(.+?)\s+account\s+(?:number\s+)?([^\s]+)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/i
  ```
- **Dashen 12-Hour AM/PM Credit**:
  ```typescript
  /your\s+account\s+['"]?([^'"]+?)['"]?\s+is\s+credited\s+with\s+ETB\s*([^\s]+)(?:\s+from\s+([^.]+?))?\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+at\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM))/i
  ```

---

## G. Database Safety & Migrations

### 1. Additive Self-Healing Migration
Existing user databases have `DATABASE_VERSION = 1` and live records. We do not drop tables or rebuild schemas. In `db/database.ts`:
```typescript
async function ensureColumnsExist(db: SQLite.SQLiteDatabase): Promise<void> {
    const txCols = await getCols('transactions');
    if (txCols.size > 0) {
        if (!txCols.has('sms_reference')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN sms_reference TEXT;');
        }
        if (!txCols.has('sms_fingerprint')) {
            await db.runAsync('ALTER TABLE transactions ADD COLUMN sms_fingerprint TEXT;');
        }
    }
}
```

### 2. Partial Unique Indexes
To enforce duplicate prevention at the SQLite level while allowing manual transactions to have `NULL` references:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_sms_ref 
  ON transactions(sms_reference) WHERE sms_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_sms_fingerprint 
  ON transactions(sms_fingerprint) WHERE sms_fingerprint IS NOT NULL;
```

### 3. Preserving Database Triggers & Flow Constraints
SQLite triggers in BanKoni enforce that:
- `DEBIT` transactions must link to a category with `flow = 'EXPENSE'`.
- `CREDIT` transactions must link to a category with `flow = 'INCOME'`.
- The target wallet must exist.

The UI pre-filters categories strictly by `candidate.type`:
```typescript
const flowCategories = categories.filter((cat) =>
    candidate.type === 'DEBIT' ? cat.flow === 'EXPENSE' : cat.flow === 'INCOME'
);
```

---

## H. Phase 2: Extended Ethiopian Provider Coverage

Phase 2 extends BanKoni's local parsing engine to four additional Ethiopian financial providers and transaction contexts without altering the core architecture.

### 1. Provider A: M-PESA Ethiopia (Safaricom)
M-PESA messages present three distinct transaction formats:
- **Pattern 1: Incoming Transfer (`CREDIT`)**:
  - *Observed structure*: `"Dear [CUSTOMER], you have received [AMOUNT] Birr from [INSTITUTION/COUNTERPARTY] on [DD/MM/YY] at [HH:mm AM/PM]. Transaction number is [REFERENCE]. Your current M-PESA balance is [BALANCE] Birr."*
  - *Ledger effect*: `CREDIT` of stated amount.
  - *Date parsing*: Uses 2-digit year format (e.g. `21/10/26 at 12:37 PM`) mapped to `2026-10-21T12:37:00+03:00` via century pivot.
  - *Reference*: Extracted directly from the body (`"Transaction number is [REF]"`).
- **Pattern 2: Safaricom Bundle Purchase (`DEBIT`)**:
  - *Observed structure*: `"Dear [CUSTOMER], you have bought a Safaricom bundle of [AMOUNT] Birr for [PHONE] on [DD/MM/YY] at [HH:mm AM/PM]. Transaction number [REFERENCE]. Your current M-PESA balance is [BALANCE] Birr."*
  - *Ledger effect*: `DEBIT` reducing wallet balance (purchase, never treated as income).
  - *Metadata*: Captures the recipient phone number in description and counterparty.
- **Pattern 3: M-PESA Cashback (`CREDIT`)**:
  - *Observed structure*: `"Congratulations, you have received a cashback of [AMOUNT] Birr for Paying via M-PESA."*
  - *Ledger effect*: `CREDIT` to the wallet.
  - *Missing date & reference handling*: The SMS contains neither a date nor a reference number. The parser tags the candidate with explicit warnings:
    - `"Transaction date was not provided in the SMS. Please verify and confirm the transaction date."`
    - `"Transaction reference was not provided in the SMS. Duplicate detection relies on transaction details."`
  - In `SmsImportModal.tsx`, the user is prompted with `"Date (Manual/Current):"` and must review the date before import.
  - *Deduplication safety*: Deduplication does **not** rely on the amount (e.g. `0.60`) alone. Fingerprints combine provider, amount, confirmed date, and counterparty. Two cashbacks on different dates produce distinct fingerprints.

### 2. Provider B: Awash Bank
- **Pattern: Incoming Account Credit (`CREDIT`)**:
  - *Observed structure*: `"Dear Customer, your Account [MASKED_ACCOUNT] has been Credited with ETB [AMOUNT] on [YYYY-MM-DD HH:mm:ss] by [COUNTERPARTY] via IPS DASHEN BANK. Your balance now is ETB [BALANCE]... Awash Bank."*
  - *Ledger effect*: `CREDIT` to the Awash account.
  - *Masked account & last 4*: Extracted from `your Account 1000****1234` $\rightarrow$ `accountLast4: '1234'`.
  - *Date parsing*: Awash uses ISO-like timestamps (`2026-10-14 08:32:28`) parsed to `2026-10-14T08:32:28+03:00`.
  - *Missing reference*: The sample does not contain a transaction reference. The parser attaches a missing-reference warning, and deduplication relies on the account, amount, timestamp, and counterparty.
- **Crucial Interbank Routing Precedence**:
  - The message body explicitly mentions `"via IPS DASHEN BANK"`. However, the institutional signature at the end confirms `"Awash Bank."`.
  - In `sms/providers/detector.ts`, institutional sign-offs (`Awash Bank`) are evaluated in Pass 1 before generic mentions (`DASHEN BANK`). This guarantees the message routes to Awash Bank and never generates a Dashen Bank result.
- **Refusal to Guess Outgoing Debits**:
  - Because no confirmed Awash debit format sample was provided, outgoing debit texts are rejected as unsupported/malformed rather than guessing format rules.

### 3. Provider C: Bank of Abyssinia (BOA)
- **Pattern 1: Confirmed Account Debit (`DEBIT`)**:
  - *Observed structure*: `"Dear [CUSTOMER], your account [MASKED_ACCOUNT] was debited with ETB [AMOUNT]. Available Balance: ETB [BALANCE]. Receipt: https://cs.bankofabyssinia.com/slip/?trx=[REF] Feedback: https://cs.bankofabyssinia.com/cs/?trx=[FEEDBACK_REF] Link your Fayda: [LINK] For help, call 8397... Bank of Abyssinia."*
  - *Ledger effect*: `DEBIT` of stated amount (`1,006.00 ETB`). No principal/fee breakdown is fabricated.
  - *Strict Receipt Reference Extraction*:
    - The message contains two URLs: a receipt slip (`/slip/?trx=FT...`) and a feedback survey (`/cs/?trx=DFT...`).
    - The parser uses a targeted regex strictly matching `/\/slip\/(?:\?[^#\s]*\btrx=|\?trx=)([A-Za-z0-9_-]+)/i`.
    - It extracts the `FT...` slip transaction reference and strictly ignores the `DFT...` feedback survey token.
    - Promotional Fayda links and support hotlines are ignored.
  - *Missing Date Workflow*:
    - The BOA debit SMS body does not contain a transaction timestamp.
    - The candidate is returned with a warning: `"Transaction date was not provided in the SMS. Please verify and confirm the transaction date."`
    - The user confirms or adjusts the date in the review modal before saving.
- **Pattern 2: Provisional Reconstructed Credit (`CREDIT`)**:
  - Extracted from a partial screenshot fragment: credited amount, counterparty, and receipt slip.
  - Isolated in `sms/providers/boa.ts` and marked with warning `"Reconstructed from partial sample: please verify amount, counterparty, and date before importing."`.

### 4. Provider D: CBE Birr Non-Transaction Handling
- **Airtime Notification**:
  - Sample: `"Dear Customer, you received 50.00Br. airtime from [PHONE] - [COUNTERPARTY] on [DATE]. Thank you for choosing CBE Birr! For Invoice use link [LINK]."`
  - *Rule*: Airtime is mobile talk-time, **not cash credited to an e-money wallet**.
  - `sms/classifier.ts` intercepts this message under `airtime_receipt` (`status: 'non_transaction'`).
  - Invoice parameters (`TID`, `PH`) are never treated as financial transaction references.
  - The message is blocked before import and cannot modify any wallet balance.
- **App-Store Promotional Announcements**:
  - Announcements encouraging users to download or update the CBE Birr app are classified as `promotional` non-transactions.

### 5. Date and Monetary Extensions
- **2-Digit Year Pivot (`expandTwoDigitYear`)**:
  - Converts 2-digit years (`26` $\rightarrow$ `2026`). For years $\le 70$, resolves to $2000 + YY$; otherwise $1900 + YY$.
- **Extended Timestamps**:
  - Supports 12-hour AM/PM with 2-digit year (`21/10/26 at 12:37 PM`).
  - Supports 24-hour with optional seconds (`09/04/26 14:36`, `2026-10-14 08:32:28`).
  - Strict calendar validation: rejects months $\notin [1, 12]$, days $\notin [1, 31]$, hours $\notin [0, 23]$, minutes $\notin [0, 59]$.
- **Birr vs. ETB Currency Normalization**:
  - Normalizes `Birr`, `Br.`, and `ETB` to canonical `ETB`.

---

## I. Privacy Model

1. **No Inbox Access**: Does not require Android `READ_SMS` or `RECEIVE_SMS` permissions. Operates purely on user-pasted text.
2. **Zero Network Transmission**: Operates 100% locally on the device CPU. Does not call any AI models, cloud parsers, or telemetry services.
3. **No Raw SMS Retention**: The `raw_sms` database column is intentionally stored as `NULL`. Sensitive raw SMS strings are cleared from component memory immediately upon import or dismissal.
4. **No Sensitive Logging**: Account numbers, balances, phone numbers, and names are never printed to console logs.
5. **Synthetic Test Fixtures**: Real SMS samples, personal names, phone numbers, and actual transaction references are never committed. All tracked tests and docs use strictly synthetic fixtures.
6. **Git Safety**: `.private-sms-samples/` and `.tests/` are protected in `.gitignore`.

---

## J. Test Matrix

All 14 test suites and 95 tests pass with zero errors:

| Test Suite | Scenario Covered | Expected Result | Status |
|---|---|---|---|
| `sms/__tests__/mpesa.test.ts` | Incoming transfer (CBE-B2C credit 300.00 Birr) | Parsed, CREDIT, ref MP2610TRX001, bal 442.00 | **PASS** |
| `sms/__tests__/mpesa.test.ts` | Safaricom bundle purchase (160.00 Birr) | Parsed, DEBIT, beneficiary phone, bal 282.00 | **PASS** |
| `sms/__tests__/mpesa.test.ts` | M-PESA cashback (0.60 Birr) | Parsed, CREDIT, missing date/ref warnings | **PASS** |
| `sms/__tests__/mpesa.test.ts` | Repeated cashback amounts with different dates | Unique SHA-256 fingerprints generated | **PASS** |
| `sms/__tests__/mpesa.test.ts` | Malformed amount and unrecognized M-PESA formats | Malformed status returned | **PASS** |
| `sms/__tests__/awash.test.ts` | Incoming credit (ETB 2,000.00, ISO date, balance) | Parsed, CREDIT, last 4 digits captured | **PASS** |
| `sms/__tests__/awash.test.ts` | Awash credit mentioning "via IPS DASHEN BANK" | Correctly detected as Awash (not Dashen) | **PASS** |
| `sms/__tests__/awash.test.ts` | Footer URL variations (Telegram, feedback links) | Links ignored, clean transaction extracted | **PASS** |
| `sms/__tests__/awash.test.ts` | Footer variation: "Awash International Bank" | Recognized and routed correctly | **PASS** |
| `sms/__tests__/awash.test.ts` | Malformed date in Awash message | Warning attached, requires manual date confirmation | **PASS** |
| `sms/__tests__/awash.test.ts` | Missing transaction reference | Warning attached, candidate valid for review | **PASS** |
| `sms/__tests__/awash.test.ts` | Unconfirmed Awash debit attempt | Malformed status (no guessing) | **PASS** |
| `sms/__tests__/boa.test.ts` | Account debit (ETB 1,006.00, bal ETB 10,862.76) | Parsed, DEBIT, balance captured | **PASS** |
| `sms/__tests__/boa.test.ts` | Distinguish slip reference from feedback reference | Extracts `/slip/?trx=FT...`, ignores `/cs/?trx=...` | **PASS** |
| `sms/__tests__/boa.test.ts` | Missing date in BOA debit | Warning attached, requires user confirmation | **PASS** |
| `sms/__tests__/boa.test.ts` | Provisional reconstructed credit format | Parsed with review warning | **PASS** |
| `sms/__tests__/cbe_birr.test.ts` | Received 50.00Br. airtime notification | Classified as `airtime_receipt` (non-transaction) | **PASS** |
| `sms/__tests__/cbe_birr.test.ts` | Invoice URL with TID/PH query params | Not parsed as a transaction reference | **PASS** |
| `sms/__tests__/cbe_birr.test.ts` | Guarantees airtime creates no transaction/wallet impact | No candidate generated, balance unchanged | **PASS** |
| `sms/__tests__/cbe_birr.test.ts` | CBE Birr app-store promo notification | Classified as `promotional` (non-transaction) | **PASS** |
| `sms/__tests__/cbe_birr.test.ts` | CBE Birr vs CBE institutional differentiation | Correctly detected as `cbe_birr` (not `cbe`) | **PASS** |
| `sms/__tests__/cbe.test.ts` | CBE debit with fee breakdown (principal + fees) | Parsed, 1312.00 total debit, 12.00 fees | **PASS** |
| `sms/__tests__/cbe.test.ts` | CBE transfer with source, destination, recipient | Parsed, 300.61 debit, recipient captured | **PASS** |
| `sms/__tests__/cbe.test.ts` | CBE credit / deposit | Parsed, 4500.00 credit, reference FT26107777 | **PASS** |
| `sms/__tests__/dashen.test.ts` | Dashen credit with person counterparty | Parsed, 12h PM time parsed to ISO (+03:00) | **PASS** |
| `sms/__tests__/dashen.test.ts` | Dashen debit without counterparty | Parsed debit, balance captured | **PASS** |
| `sms/__tests__/telebirr.test.ts` | Telebirr outgoing transfer to CBE | Parsed, 1006.00 derived debit, dual references | **PASS** |
| `sms/__tests__/telebirr.test.ts` | Telebirr incoming deposit from CBE | Parsed credit, CBE counterparty, reference | **PASS** |
| `sms/__tests__/telebirr.test.ts` | Telebirr monthly package purchase | Parsed debit, package description captured | **PASS** |
| `sms/__tests__/cleaners.test.ts` | 2-digit year expansion and calendar validation | Accurate 2026 mapping, rejects invalid dates | **PASS** |
| `sms/__tests__/matcher.test.ts` | Account last-4 and single/multiple wallet matching | Returns exact_account, provider_only, ambiguous | **PASS** |
| `sms/__tests__/fingerprint.test.ts`| Deterministic SHA-256 fingerprinting | Stable hash across identical normalized fields | **PASS** |
| `sms/__tests__/integration.test.ts`| Full lifecycle: parse -> match -> deduplicate -> save | Complete persistence & balance updates verified | **PASS** |

---

## K. Manual Testing Instructions

To verify the Phase 2 workflow in the running application (e.g. `npx expo start`):

1. **Open Transactions Screen**: Tap the "Transactions" tab in the bottom bar.
2. **Open SMS Import**: Tap the message bubble icon next to the `+` button in the header.

3. **Test 1 — M-PESA Safaricom Bundle Purchase (`DEBIT`)**:
   - Paste:
     ```text
     Dear Customer, you have bought a Safaricom bundle of 160.00 Birr for 0712345678 on 21/10/26 at 12:37 PM. Transaction number MP2610BND002. Your current M-PESA balance is 282.00 Birr. Get your receipt here: https://example.com/receipt. Use the below link to harmonize your M-PESA account with Fayda: https://example.com/fayda
     ```
   - Tap **Parse SMS**.
   - Verify: Provider shows M-PESA, Type is **EXPENSE (`DEBIT`)**, Amount is `ETB 160.00`, Ref is `MP2610BND002`, Balance is `ETB 282.00`.
   - Select an Expense Category and M-PESA Wallet $\rightarrow$ Tap **Confirm & Import**.
   - Verify: Transaction is saved and M-PESA wallet balance decreases by $160.00$.

4. **Test 2 — M-PESA Cashback (Missing Date & Reference Review)**:
   - Paste:
     ```text
     Congratulations, you have received a cashback of 0.60 Birr for Paying via M-PESA.
     ```
   - Tap **Parse SMS**.
   - Verify: Provider is M-PESA, Type is **INCOME (`CREDIT`)**, Amount is `ETB 0.60`.
   - Notice Date field says `"Date (Manual/Current):"`. Yellow warning banner alerts that date and reference were absent.
   - Select an Income Category $\rightarrow$ Tap **Confirm & Import**.
   - Verify: Transaction imports cleanly. Pasting another cashback and confirming a different date creates a second valid transaction without duplicate rejection.

5. **Test 3 — Awash Bank Credit with Interbank IPS Mention**:
   - Paste:
     ```text
     Dear Customer, your Account 1000****1234 has been Credited with ETB 2000.00 on 2026-10-14 08:32:28 by ABEBE BIKILA via IPS DASHEN BANK. Your balance now is ETB 34720.30. For any complaint or enquiry, please call 8980. Subscribe to our official Telegram channel: https://t.me/example for more information. Please give us your feedback using the following link: https://example.com/survey. Awash Bank.
     ```
   - Tap **Parse SMS**.
   - Verify: Provider is **Awash Bank** (NOT Dashen Bank), Type is **INCOME (`CREDIT`)**, Amount is `ETB 2,000.00`, Date is `Oct 14, 2026, 08:32:28`, Balance is `ETB 34,720.30`.
   - Confirm & Import to Awash Wallet.

6. **Test 4 — Bank of Abyssinia Debit (Receipt vs Feedback Reference)**:
   - Paste:
     ```text
     Dear Customer, your account 1000****5678 was debited with ETB 1,006.00. Available Balance: ETB 10,862.76. Receipt: https://cs.bankofabyssinia.com/slip/?trx=FT2610ABCDEF Feedback: https://cs.bankofabyssinia.com/cs/?trx=DFT98765432 Link your Fayda: https://example.com/fayda For help, call 8397 (24/7 Toll-Free). Bank of Abyssinia.
     ```
   - Tap **Parse SMS**.
   - Verify: Provider is **Bank of Abyssinia**, Type is **EXPENSE (`DEBIT`)**, Amount is `ETB 1,006.00`, Ref is `FT2610ABCDEF` (the feedback survey token `DFT98765432` is ignored!).
   - Warning banner indicates date was absent from SMS; user confirms current date.
   - Confirm & Import to BOA Wallet.

7. **Test 5 — CBE Birr Airtime Rejection**:
   - Paste:
     ```text
     Dear Customer, you received 50.00Br. airtime from 0911223344 - ABEBE BIKILA on 09/04/26 14:36. Thank you for choosing CBE Birr! For Invoice use link https://example.com/invoice?TID=CB123456&PH=0911223344
     ```
   - Tap **Parse SMS**.
   - Verify: Red/orange banner states `"Non-ledger message detected: airtime receipt. Airtime notifications represent mobile recharge, not cash deposited to your financial wallet."`.
   - The message cannot be imported, and no wallet balance changes.

---

## L. Remaining Limitations

1. **User-Controlled Paste Flow**: Operates purely on user-pasted text. No background SMS listener is installed.
2. **Provisional BOA Credit Pattern**: BOA incoming credit format was developed from a partial screenshot fragment and remains provisional until a complete raw SMS sample is available.
3. **Unconfirmed Awash Debit Pattern**: Awash debit format is intentionally not implemented to avoid guesswork without verified samples.
4. **Receipt Image Fetching**: Receipt URLs are used solely for reference extraction; external receipt images are not downloaded over the network.
5. **Spoofing Disclaimer**: SMS parsing verifies string patterns, not banking authenticity. A pasted SMS can be fabricated; user review is mandatory before ledger commitment.

---

## M. Suggested Learning Sequence

For students and developers exploring the codebase:

1. **[`sms/types.ts`](file:///home/Sami/Documents/MoniVO-/sms/types.ts)**: Domain contracts, candidate structures, and provider IDs.
2. **[`sms/cleaners.ts`](file:///home/Sami/Documents/MoniVO-/sms/cleaners.ts)**: Integer santim arithmetic, 2-digit year pivot, and ISO date parsing.
3. **[`sms/classifier.ts`](file:///home/Sami/Documents/MoniVO-/sms/classifier.ts)**: Filtering non-ledger airtime, OTPs, and marketing announcements.
4. **[`sms/providers/detector.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/detector.ts)**: Institutional signature precedence over interbank routing text.
5. **[`sms/providers/mpesa.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/mpesa.ts)**: M-PESA transfers, bundle purchases, and cashback handling.
6. **[`sms/providers/awash.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/awash.ts)**: Awash incoming credits and account matching.
7. **[`sms/providers/boa.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/boa.ts)**: BOA debits and targeted receipt URL reference extraction.
8. **[`sms/matcher.ts`](file:///home/Sami/Documents/MoniVO-/sms/matcher.ts)**: Safe wallet matching without silent auto-selection.
9. **[`sms/fingerprint.ts`](file:///home/Sami/Documents/MoniVO-/sms/fingerprint.ts)**: Deterministic SHA-256 duplicate detection.
10. **[`components/modals/SmsImportModal.tsx`](file:///home/Sami/Documents/MoniVO-/components/modals/SmsImportModal.tsx)**: User review, missing date prompts, and confirmation flow.

---

## M. Glossary

- **Parser**: A pure software function that decomposes unstructured or semi-structured text into a strongly typed data object.
- **Candidate Transaction**: A proposed transaction extracted from an SMS message that has been validated by the parser but not yet approved or saved by the user.
- **Principal**: The initial amount of money transferred, paid, or received before bank charges or taxes are applied.
- **Ledger Amount**: The net amount of money that actually leaves or enters the account balance (e.g., $\text{Principal} + \text{Service Fee} + \text{VAT}$).
- **Fee Breakdown**: The itemized accounting of service charges, value-added tax (VAT), and disaster relief funds deducted by the financial provider.
- **Discriminated Union**: A TypeScript pattern where a type is a union of multiple object structures, each sharing a common literal property (e.g. `status: 'parsed' | 'ambiguous' | 'malformed'`) allowing safe compile-time type narrowing.
- **Capture Group**: A portion of a regular expression enclosed in parentheses `(...)` that extracts matching substrings into indexed or named fields.
- **Fingerprint**: A deterministic cryptographic hash generated from transaction fields used to identify identical transactions without storing the original text.
- **Idempotency**: The property of an operation whereby performing it multiple times yields the exact same result as performing it once, preventing duplicate records.
- **Migration**: A controlled database script that alters schema structures (adding columns, tables, or indexes) without destroying existing user data.
- **Review Flow**: The UI stage where an extracted candidate is presented to the user for human verification before writing to persistent storage.
- **Source of Truth**: The definitive repository of record for an application's data. In BanKoni, SQLite is the single source of truth, and Zustand reflects its state.
