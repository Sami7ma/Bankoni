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

## Known gaps

- Budget and analytics calculations at the screen level are inconsistent about the `CLEARED`-only filter that the store totals use.
- Budget recurrence and alert fields exist in the schema, but nothing renews or notifies automatically.
- The Analytics "Year" view shows 6 monthly buckets, not 12.
- The rolling 4-week spending bucket logic is duplicated in `HomeSpendingChart.tsx` and `AnalyticsScreen.tsx`.
- `useBanKoniStore.ts` logs raw caught errors on export and import failure paths.

## Future SMS parsing

Not implemented. Transaction creation should stay behind the store and db layer so an SMS importer can call the same write path later.
