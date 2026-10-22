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
│                      ┌─────────────────────────┼──────────────────┐    │
│                      ▼                         ▼                  ▼    │
│                 parseCbeSms              parseDashenSms    parseTelebirrSms
│                      └─────────────────────────┼──────────────────┘    │
│                                                ▼                       │
│                                      SmsParseResult                    │
│                                  (Discriminated Union)                 │
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

### New Domain Files (`sms/`)

1. **[`sms/types.ts`](file:///home/Sami/Documents/MoniVO-/sms/types.ts)**:
   - *Category*: Domain Model.
   - *Why it exists*: Defines the TypeScript contracts for provider IDs, parsed candidate transactions, fee breakdowns, and the `SmsParseResult` discriminated union.
   - *Dependencies*: None.
   - *Depended on by*: All parser files, UI modal, tests.

2. **[`sms/cleaners.ts`](file:///home/Sami/Documents/MoniVO-/sms/cleaners.ts)**:
   - *Category*: Pure Domain Utility.
   - *Why it exists*: Handles text normalization (zero-width spaces, non-breaking spaces, CRLF), exact decimal parsing into integer santim (1 ETB = 100 santim), formatting, account masking/suffix extraction, and Ethiopian timezone (`+03:00`) ISO date parsing.
   - *Dependencies*: None.
   - *Depended on by*: All provider parsers, tests.

3. **[`sms/classifier.ts`](file:///home/Sami/Documents/MoniVO-/sms/classifier.ts)**:
   - *Category*: Pure Domain Classifier.
   - *Why it exists*: Filters out non-ledger events before regex matching begins: OTP verification codes, ATM withdrawal authorization secrets, airtime receipts, promotional texts, and declined transactions.
   - *Dependencies*: `sms/cleaners.ts`.
   - *Depended on by*: `sms/index.ts`.

4. **[`sms/fingerprint.ts`](file:///home/Sami/Documents/MoniVO-/sms/fingerprint.ts)**:
   - *Category*: Cryptographic Deduplication Utility.
   - *Why it exists*: Generates a deterministic SHA-256 hash (64 hex characters) from normalized transaction fields (`providerId`, `type`, `ledgerAmount`, `accountLast4`, `dateTime`, `counterparty`). Implemented as a zero-dependency pure TypeScript SHA-256 algorithm to guarantee identical execution across Node.js, Jest, and mobile runtimes (Hermes / JSC).
   - *Dependencies*: `sms/types.ts`.
   - *Depended on by*: `sms/index.ts`, UI modal, tests.

5. **[`sms/providers/detector.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/detector.ts)**:
   - *Category*: Domain Routing.
   - *Why it exists*: Uses a two-pass detection algorithm to identify whether a message originates from CBE, Dashen, or Telebirr. Pass 1 prioritizes strong institutional sign-offs (`Ethio telecom`, `Dashen Bank - Always one step ahead`, `Banking with CBE`) over weak mentions (such as a Dashen deposit mentioning "from Telebirr").
   - *Dependencies*: `sms/types.ts`.
   - *Depended on by*: `sms/index.ts`.

6. **[`sms/providers/cbe.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/cbe.ts)**:
   - *Category*: Provider-Specific Parser.
   - *Why it exists*: Parses Commercial Bank of Ethiopia messages:
     - Pattern 1: Debit transactions with fee breakdowns (principal, service charge, VAT, disaster recovery, total debit).
     - Pattern 2: Outgoing transfers with source/destination account and recipient name.
     - Pattern 3: Incoming credits/deposits.
     - Extracts reference from `id=FT...`, receipt URLs, or standalone FT transaction identifiers.
     - Performs exact santim arithmetic validation (`principal + fees == total`).
   - *Dependencies*: `sms/types.ts`, `sms/cleaners.ts`.

7. **[`sms/providers/dashen.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/dashen.ts)**:
   - *Category*: Provider-Specific Parser.
   - *Why it exists*: Parses Dashen Bank messages:
     - Pattern 1: Incoming credit transactions with optional counterparty and 12-hour AM/PM time (`DD/MM/YYYY at hh:mm:ss AM/PM`).
     - Pattern 2: Outgoing debit transactions.
     - Extracts account identifiers, balances, and transaction references.
   - *Dependencies*: `sms/types.ts`, `sms/cleaners.ts`.

8. **[`sms/providers/telebirr.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/telebirr.ts)**:
   - *Category*: Provider-Specific Parser.
   - *Why it exists*: Parses Telebirr messages:
     - Pattern 1: Outgoing bank transfers with derived total debit (`principal + service fee + 15% VAT`), dual references (Telebirr txn number and bank txn number), and destination account details.
     - Pattern 2: Incoming bank transfers/deposits with sending institution, account holder, and ISO or DD/MM/YYYY timestamps.
     - Pattern 3: Package purchases (internet, airtime packages) as ledger debits.
     - Pattern 4: General P2P payments.
   - *Dependencies*: `sms/types.ts`, `sms/cleaners.ts`.

9. **[`sms/matcher.ts`](file:///home/Sami/Documents/MoniVO-/sms/matcher.ts)**:
   - *Category*: Domain Wallet Matching.
   - *Why it exists*: Matches a candidate against user wallets. Confidence levels: `exact_account` (matches provider AND last 4 digits), `provider_only` (only 1 wallet for provider), `ambiguous` (multiple candidate wallets), `none` (no matching provider wallet).
   - *Dependencies*: `types/Wallet.ts`, `sms/types.ts`.

10. **[`sms/index.ts`](file:///home/Sami/Documents/MoniVO-/sms/index.ts)**:
    - *Category*: Public Domain Entry Point.
    - *Why it exists*: Exposes `parseSms()` and re-exports all domain types, utilities, and matchers.

### Modified Existing Files

11. **[`types/Transaction.ts`](file:///home/Sami/Documents/MoniVO-/types/Transaction.ts)**:
    - *Category*: Core Type Definition.
    - *Change*: Added optional fields: `source?: 'manual' | 'sms'`, `smsReference?: string`, `smsFingerprint?: string`.

12. **[`db/database.ts`](file:///home/Sami/Documents/MoniVO-/db/database.ts)**:
    - *Category*: Persistence / SQLite Repository.
    - *Change*:
      - Updated `TransactionRow` interface with `sms_reference` and `sms_fingerprint`.
      - Added additive column checks in `ensureColumnsExist()`: adds `sms_reference TEXT` and `sms_fingerprint TEXT` if missing.
      - Added partial unique indexes in `INDEXES_AND_TRIGGERS_SQL`: `idx_transactions_unique_sms_ref` and `idx_transactions_unique_sms_fingerprint` (`WHERE ... IS NOT NULL`).
      - Updated `mapTransaction()` to map `source`, `smsReference`, and `smsFingerprint`.
      - Updated `insertTransactionDB()` to validate duplicate references/fingerprints, persist them, and keep balance updates atomic.
      - Exported `checkSmsDuplicateDB()` for UI pre-checks.

13. **[`components/modals/SmsImportModal.tsx`](file:///home/Sami/Documents/MoniVO-/components/modals/SmsImportModal.tsx)**:
    - *Category*: UI Modal Component.
    - *Change*: Brand new component implementing the complete Paste $\rightarrow$ Parse $\rightarrow$ Review $\rightarrow$ Import workflow.

14. **[`components/modals/AddTransactionModal.tsx`](file:///home/Sami/Documents/MoniVO-/components/modals/AddTransactionModal.tsx)**:
    - *Category*: UI Modal Component.
    - *Change*: Added `onOpenSmsImport` optional prop and shortcut link "Import from SMS instead".

15. **[`app/(app)/TransactionScreen.tsx`](file:///home/Sami/Documents/MoniVO-/app/(app)/TransactionScreen.tsx)**:
    - *Category*: Main Navigation Screen.
    - *Change*: Added header button with `MessageSquareText` icon next to the Add button, modal state wiring, and integrated `<SmsImportModal>`.

16. **[`.gitignore`](file:///home/Sami/Documents/MoniVO-/.gitignore)**:
    - *Category*: Git Configuration.
    - *Change*: Added `.private-sms-samples/` and `.tests/` to prevent private real SMS samples from being tracked.

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

## H. Privacy Model

1. **No Inbox Access**: Does not require Android `READ_SMS` or `RECEIVE_SMS` permissions. Operates purely on user-pasted text.
2. **Zero Network Transmission**: Operates 100% locally on the device CPU. Does not call any AI models, cloud parsers, or telemetry services.
3. **No Raw SMS Retention**: The `raw_sms` database column is intentionally stored as `NULL`. Sensitive raw SMS strings are cleared from component memory immediately upon import or dismissal.
4. **No Sensitive Logging**: Account numbers, balances, phone numbers, and names are never printed to console logs.
5. **Git Safety**: Real SMS samples and `.private-sms-samples/` are added to `.gitignore`. All unit test fixtures use synthetic, anonymized values.

---

## I. Test Matrix

| Test Suite | Scenario Covered | Expected Result | Result |
|---|---|---|---|
| `sms/__tests__/cbe.test.ts` | CBE debit with service charge, VAT, disaster recovery | Parsed, 1312.00 total debit, 12.00 fees | **PASS** |
| `sms/__tests__/cbe.test.ts` | CBE transfer with source, destination, recipient | Parsed, 300.61 debit, recipient captured | **PASS** |
| `sms/__tests__/cbe.test.ts` | CBE credit / deposit | Parsed, 4500.00 credit, reference FT26107777 | **PASS** |
| `sms/__tests__/cbe.test.ts` | CBE fee arithmetic mismatch | Ambiguous result with mismatch warning | **PASS** |
| `sms/__tests__/cbe.test.ts` | CBE OTP rejection | Non-transaction status (`otp`) | **PASS** |
| `sms/__tests__/dashen.test.ts` | Dashen credit with person counterparty | Parsed, 12h PM time parsed to ISO (+03:00) | **PASS** |
| `sms/__tests__/dashen.test.ts` | Dashen credit from Telebirr | Parsed to Dashen (not Telebirr) | **PASS** |
| `sms/__tests__/dashen.test.ts` | Dashen debit without counterparty | Parsed debit, balance captured | **PASS** |
| `sms/__tests__/dashen.test.ts` | Dashen invalid/negative amount | Malformed status | **PASS** |
| `sms/__tests__/telebirr.test.ts` | Telebirr outgoing transfer to CBE | Parsed, 1006.00 derived debit, dual references | **PASS** |
| `sms/__tests__/telebirr.test.ts` | Telebirr incoming deposit from CBE | Parsed credit, CBE counterparty, reference | **PASS** |
| `sms/__tests__/telebirr.test.ts` | Telebirr monthly package purchase | Parsed debit, package description captured | **PASS** |
| `sms/__tests__/telebirr.test.ts` | Telebirr ATM withdrawal secret code | Non-transaction (`atm_authorization`) | **PASS** |
| `sms/__tests__/telebirr.test.ts` | Telebirr airtime receipt | Non-transaction (`airtime_receipt`) | **PASS** |
| `sms/__tests__/matcher.test.ts` | Exact account matching (last 4 digits) | Returns `exact_account` confidence | **PASS** |
| `sms/__tests__/matcher.test.ts` | Single provider wallet matching | Returns `provider_only` confidence | **PASS** |
| `sms/__tests__/matcher.test.ts` | Multiple wallets for same provider | Returns `ambiguous` (no silent auto-pick) | **PASS** |
| `sms/__tests__/fingerprint.test.ts`| Deterministic SHA-256 fingerprinting | Identical hash for same event, unique for different | **PASS** |
| `sms/__tests__/cleaners.test.ts` | Decimal santim integer arithmetic | Exact 100 santim = 1 ETB, avoids float artifacts | **PASS** |
| `sms/__tests__/integration.test.ts`| End-to-end parse -> match -> deduplicate -> save | Complete lifecycle validated | **PASS** |

---

## J. Manual Testing Instructions

To verify the workflow in the running application (e.g. `npx expo start`):

1. **Open Transactions Screen**: Tap the "Transactions" tab in the bottom bar.
2. **Open SMS Import**: Tap the message bubble icon next to the `+` button in the header (or tap `+` and choose "Import from SMS instead").
3. **Test 1 — CBE Debit with Fees**:
   - Paste:
     ```text
     Dear Customer, A debit transaction of ETB 1300.0 has occurred on your account 1000****1234. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB1312.00. Your current balance is ETB840,060.64. Thanks for Banking with CBE. https://apps.cbe.com.et:100/?id=FT26109988
     ```
   - Tap **Parse SMS**.
   - Verify: Review card shows Commercial Bank of Ethiopia, EXPENSE, Total Debit `-ETB 1,312.00`, Fee Breakdown shows Service Charge 10.00, VAT 1.50, Disaster Recovery 0.50.
   - Select an Expense Category and Wallet $\rightarrow$ Tap **Confirm & Import**.
   - Verify transaction appears in the list and wallet balance decreases by $1,312.00$.
4. **Test 2 — Duplicate Prevention**:
   - Tap the SMS Import icon again and paste the exact same text from Test 1.
   - Tap **Parse SMS**.
   - Verify: Red duplicate alert appears stating `"A transaction with reference "FT26109988" is already in your database."`
5. **Test 3 — Telebirr Derived Fees**:
   - Paste:
     ```text
     Dear Customer, You have transferred ETB 1,000.00 successfully from your telebirr account 09****1234 to Commercial Bank of Ethiopia account number 1000****5678 on 21/10/2026 13:28:24. Your telebirr transaction number is RA26109911 and your bank transaction number is FT88771122. The service fee is ETB 5.22 and 15% VAT on the service fee is ETB 0.78. Your current balance is ETB 383.83. Thank you for using telebirr. Ethio telecom.
     ```
   - Tap **Parse SMS**.
   - Verify: Ledger Amount displays `-ETB 1,006.00` (derived from $1,000 + 5.22 + 0.78$). Telebirr Ref and Bank Ref are both displayed.
6. **Test 4 — Non-Transaction Rejection**:
   - Paste:
     ```text
     Dear Customer, your telebirr ATM withdrawal secret code is 849201 for ETB 500.00 withdrawal request. Valid for 15 minutes. Ethio telecom.
     ```
   - Tap **Parse SMS**.
   - Verify: Message is rejected with `"Non-ledger message detected: ATM withdrawal secret code"`.
7. **Test 5 — Missing Date**:
   - Paste a CBE debit without a date.
   - Tap **Parse SMS**.
   - Verify: Warning banner alerts that date was not specified, and the current local date/time is confirmed.

---

## K. Remaining Limitations

1. **No Background Native SMS Sniffing**: The current MVP is intentionally user-controlled (paste-based) to ensure platform independence (iOS and Android) and to protect Google Play store approval.
2. **Provider Scope**: Restricted to Commercial Bank of Ethiopia (CBE), Dashen Bank, and Telebirr. Other banks (Awash, Abyssinia, Bank of Abyssinia, Coop) are not yet supported.
3. **Receipt Links**: CBE and Telebirr receipt URLs are parsed purely for transaction ID extraction. The application does not fetch or download external receipt images over the network.
4. **Fallback Fingerprint Collisions**: If a user performs two identical transactions with the exact same amount to the same counterparty within the exact same second, and the provider does not provide a transaction reference number, the second transaction will be flagged as a duplicate.

---

## L. Suggested Learning Sequence

For students and developers reading this codebase for the first time, read the files in this order:

1. **[`sms/types.ts`](file:///home/Sami/Documents/MoniVO-/sms/types.ts)**: Start here to see the domain model and what a parsed transaction candidate looks like.
2. **[`sms/cleaners.ts`](file:///home/Sami/Documents/MoniVO-/sms/cleaners.ts)**: Learn how exact integer santim arithmetic prevents floating-point rounding bugs.
3. **[`sms/classifier.ts`](file:///home/Sami/Documents/MoniVO-/sms/classifier.ts)**: Understand why OTPs and authorization codes must be filtered out before pattern matching.
4. **[`sms/providers/cbe.ts`](file:///home/Sami/Documents/MoniVO-/sms/providers/cbe.ts)**: Study real-world bank regex patterns, capture groups, and fee arithmetic checks.
5. **[`sms/fingerprint.ts`](file:///home/Sami/Documents/MoniVO-/sms/fingerprint.ts)**: See how pure SHA-256 deduplication works without external dependencies.
6. **[`sms/matcher.ts`](file:///home/Sami/Documents/MoniVO-/sms/matcher.ts)**: Understand how candidate transactions are safely linked to user wallets.
7. **[`db/database.ts`](file:///home/Sami/Documents/MoniVO-/db/database.ts)**: Examine how additive migrations, foreign keys, triggers, and transactions protect financial integrity.
8. **[`components/modals/SmsImportModal.tsx`](file:///home/Sami/Documents/MoniVO-/components/modals/SmsImportModal.tsx)**: See how the user interface presents candidate data for human review.

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
