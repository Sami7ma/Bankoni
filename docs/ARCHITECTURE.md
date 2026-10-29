# Architecture

## Entry flow

`index.ts` → `App.tsx` → `app/navigation/AppNavigator.tsx`

Navigation uses **React Navigation** (a stack for auth plus bottom tabs). It does **not** use Expo Router. The `(app)` and `(auth)` folder names are organizational only.

| Folder | Role |
|---|---|
| `app/(auth)/` | Onboarding, Register, Login (PIN and biometric) |
| `app/(app)/` | Home, Transactions, Wallets, Budgets, Analytics, Settings |
| `app/navigation/` | `AppNavigator` and param types |
| `components/` | Reusable UI: `common/`, `home/`, `modals/`, `wallets/` |
| `store/useBanKoniStore.ts` | Zustand: session and UI cache plus async actions |
| `db/database.ts` | SQLite schema, validation, CRUD, import and export |
| `security/pinSecurity.ts` | Versioned salted scrypt PIN hashing, legacy plaintext PIN migration |
| `hooks/useTheme.ts`, `constants/theme.ts` | Theme tokens (light and dark) |
| `constants/walletProviders.ts`, `constants/bankLogosSvg.ts`, `components/wallets/WalletLogo.tsx` | Provider metadata and logo rendering |
| `constants/defaultCategories.ts` | Built-in categories |
| `types/` | Shared TypeScript types |

## Data flow

```
Screen / form → Zustand action → SQLite write → reload affected collections → UI re-render
```

## Data model and invariants

- Database file `bankoni.db`; WAL mode and foreign keys enabled; `DATABASE_VERSION = 1`.
- A fresh install seeds the built-in categories and one zero-balance "Cash" wallet. It seeds no demo transactions or budgets.
- Wallet balance = opening balance + cleared credits − cleared debits.
- The total balance is the sum of active ETB wallets.
- Transaction statuses are `PENDING` and `CLEARED`. The add-transaction form currently only creates `CLEARED`.
- Lock and logout clear in-memory session state only. Persisted records are untouched.
- Startup database read errors stop navigation. They are not treated as a fresh install.
- Wallet logos are rendered from SVG XML strings embedded in `constants/bankLogosSvg.ts`. The database stores only a stable `provider_id`, never image data.

## Security model

- The PIN (4 to 12 digits) is stored as a salted scrypt hash. Wrong attempts trigger a persisted cooldown.
- `expo-secure-store` holds preferences only. Financial data and the PIN hash are in plain SQLite.
- Export is plain JSON without the PIN hash. Import replaces data; it preserves the device PIN and updates the profile name and email from the file.

## Financial Intelligence & Calculations Engine

All financial analytics, period aggregations, category breakdowns, daily pace metrics, and budget pacing forecasts are computed via pure domain functions in `utils/financial.ts` and `utils/date.ts`, decoupled from React state, SQLite, and Zustand:

1. **Ethiopian Local Date Boundaries (`utils/date.ts`):**
   - Operates on East Africa Time (`UTC+3`, EAT).
   - Resolves the midnight-to-3:00 AM UTC split bug: naive `new Date().toISOString().split('T')[0]` shifts EAT transactions between 00:00:00 and 02:59:59 to the previous calendar day. All calendar operations use `getEthiopianDateString()`, shifting by `+3 hours` before reading UTC components.
   - Standard period boundaries (`Week`: rolling 7 days; `Month`: rolling 28 days in 4 weekly buckets; `Year`: rolling 12 calendar months).

2. **Period Financial Correctness (`utils/financial.ts`):**
   - Summaries, trend charts, category spending, and insights strictly respect the active period range (`Week`, `Month`, `Year`) rather than all-time totals.
   - Net Cash Flow = `Period Income - Period Expenses`.
   - Fair Prior-Period Comparisons: Prior period change percentages are displayed **only** when user transaction history began on or before the start of the prior period. History is never fabricated.
   - Average Daily Spending: Guarded against single-transaction distortion; requires `activeDays >= 2` and non-zero expenses to report a daily pace.

3. **Budget Run-Rate Pacing & Forecasting:**
   - Budget consumption is evaluated strictly within each budget's `[startDate, endDate]` range for `CLEARED` transactions on active ETB wallets matching `categoryId` and optional `walletId`.
   - Run-rate projection (`projectedTotal = dailyPace * totalDays`) requires `isBudgetActive`, `elapsedDays >= 2`, and `spent > 0`. Day-1 or zero-elapsed-days projections are strictly suppressed.
   - Deterministic status levels:
     - `EXCEEDED`: `spent >= limitAmount`
     - `WARNING`: `spent >= limitAmount * alertThreshold` (default 80%)
     - `PACING_OVER`: current run-rate daily pace will exceed limit before budget end date
     - `ON_TRACK`: within allowance and below threshold

4. **Internal Transfers & Reimbursements Classification:**
   - Internal transfers between user's own wallets (e.g. CBE to Telebirr) are excluded from economic income and expenses via `tx.isTransfer === true` while preserving wallet balance movements.
   - Reimbursements/refunds are treated as chronological cash flow events (`CREDIT` under Refund category) reflecting actual liquidity timing without retroactively erasing historical expense records.

## Security model

- The PIN (4 to 12 digits) is stored as a salted scrypt hash. Wrong attempts trigger a persisted cooldown.
- `expo-secure-store` holds preferences only. Financial data and the PIN hash are in plain SQLite.
- Export is plain JSON without the PIN hash. Import replaces data; it preserves the device PIN and updates the profile name and email from the file.

## Resolved Calculation Gaps

- Fixed: Analytics summary cards now reflect selected period rather than all-time totals.
- Fixed: Category spending respects selected period boundaries.
- Fixed: UTC conversion bug eliminated via EAT-aware date utilities.
- Fixed: Line chart, category list, and summary cards use identical period boundaries.
- Fixed: Budget cards show actual spent, remaining balance, days remaining, and pacing forecasts.
