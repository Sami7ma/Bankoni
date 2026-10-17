# BanKoni — Codebase Audit & Stage 1 Implementation Report

**Product Identity:** BanKoni (formerly MoniVo) — Local-First Personal Finance for Ethiopia  
**Database Engine:** SQLite (`expo-sqlite` / SQLite 3.51.2 WAL Mode)  
**Architecture:** Offline-first, single local vault with scrypt PIN & biometric unlock, Zustand state management  
**Audit Date:** October 11, 2026  

---

## 1. Executive Summary & Root Cause Analysis

### The Phantom ETB 12,450 Balance
During initial inspection, fresh installations displayed a starting balance of **ETB 12,450.00** before any user transaction was entered.

* **Root Cause:** In `frontend/utils/dummyData.ts`, `defaultWallet` was hardcoded with `balance: 12450.00`. This mock object was directly imported into the production database bootstrap function (`database.ts:seedInitialData`).
* **Compounding Migration Defect:** In `DATABASE_VERSION = 2`, `reconcileWalletBalances` ran an additive update:
  $$\text{balance} \leftarrow \text{balance} + \text{net\_transactions}$$
  Because `balance` began at ETB 12,450, any real user transactions were added *on top* of the phantom balance. For empty installations, the balance remained permanently stuck at ETB 12,450.

---

## 2. Stage 1 Implementation Results

### 2.1 Complete Removal of Dummy Financial Data
* **Removed Module:** `frontend/utils/dummyData.ts` has been completely deleted from the repository.
* **Production Decoupling:** `frontend/db/database.ts` no longer imports or references any mock data.
* **Zero Starting Balance:** Fresh database initialization (`seedInitialData`) seeds a default Cash wallet (`wallet-cash-default`) with:
  * `provider_id`: `'cash'`
  * `opening_balance`: `0.00`
  * `balance`: `0.00`
  * `currency`: `'ETB'`
  * `is_default`: `1`
* **Restart Idempotency:** The transaction and budget tables are never seeded with mock data. Empty tables remain empty across restarts. Deleted records are never resurrected. Built-in categories are safely preserved using `INSERT OR IGNORE`.

---

### 2.2 Balance Model & Idempotent Migration Safety

#### The Balance Invariant
Every wallet record strictly adheres to the mathematical invariant:
$$\text{Current Balance} = \text{Opening Balance} + \sum_{\substack{T \in \text{Transactions} \\ T.\text{status} = 'CLEARED'}} (\text{if } T.\text{type} = 'CREDIT' \text{ then } +T.\text{amount} \text{ else } -T.\text{amount})$$

* **Opening Balance:** Stored in the dedicated column `wallets.opening_balance`. Represents the legitimate initial amount on the account before tracking started.
* **Transaction Net:** The sum of all cleared credits minus cleared debits.
* **Balance Adjustments:** Changing a wallet's opening balance recalculates current balance without altering transaction history.

#### Version 3 Migration (`migrateToVersion3`)
For existing installations, `DATABASE_VERSION` was bumped from `2` to `3`. The migration is completely idempotent and safe:
1. Adds `provider_id`, `opening_balance`, `account_number_last4`, and `is_archived` columns via `ALTER TABLE` if missing.
2. For the known legacy seeded default wallet (`wallet-1` or `wallet-cash-default`), the fabricated ETB 12,450 starting balance is removed by setting `opening_balance = 0.00` and `provider_id = 'cash'`.
3. Recomputes `balance = opening_balance + net_transactions`.
   * If the user had **0 transactions**, the balance cleanly becomes **ETB 0.00**.
   * If the user had **real transactions** (e.g., +5,000 salary, -1,500 rent = +3,500), all transactions are preserved 100% intact, and the wallet balance becomes exactly **ETB 3,500.00**.
4. Does **not** delete any user records or transactions.
5. Sets `PRAGMA user_version = 3;`.

---

### 2.3 The Six-Tab Navigation Hierarchy

The bottom navigation (`frontend/app/navigation/AppNavigator.tsx`) has been updated to the exact six-tab order:

1. **Home** (`HomeScreen`) — Balance overview, recent activity, quick transaction entry
2. **Transactions** (`TransactionScreen`) — Search, filter, and view cleared/pending records
3. **Wallets** (`WalletsScreen`) — Dedicated, first-class wallet destination
4. **Budgets** (`BudgetsScreen`) — Category spending caps and progress bars
5. **Analytics** (`AnalyticsScreen`) — Visual breakdown and spending trends
6. **Settings** (`SettingsScreen`) — Vault security, profile, preferences, and data backup

---

### 2.4 Wallet Provider Catalogue & Asset Architecture

#### Catalogue Entries (`frontend/constants/walletProviders.ts`)
| Provider ID | Display Name | Type | Currency | Brand Color | Logo Status |
|---|---|---|---|---|---|
| `cash` | Physical Cash | `cash` | ETB | `#10B981` | Lucide `Banknote` icon |
| `cbe` | Commercial Bank of Ethiopia (CBE) | `bank` | ETB | `#841774` | Clean Vector SVG (`assets/BankIcons/Commercial Bank of Ethiopia Logo.svg`) |
| `boa` | Bank of Abyssinia (BOA) | `bank` | ETB | `#B87333` | Clean Vector SVG (`assets/BankIcons/Bank of Abyssinia Logo.svg`) |
| `dashen` | Dashen Bank | `bank` | ETB | `#0B3B60` | Clean Vector SVG (`assets/BankIcons/Dashen Bank Logo.svg`) |
| `hibret` | Hibret Bank | `bank` | ETB | `#E67300` | Clean Vector SVG (`assets/BankIcons/Hibret Bank  Logo.svg`) |
| `cbe_birr` | CBE Birr | `mobile_money` | ETB | `#9B287B` | Clean Vector SVG (`assets/BankIcons/CBE Birr Logo.svg`) |
| `telebirr` | Telebirr | `mobile_money` | ETB | `#0172BB` | Clean Vector SVG (`assets/BankIcons/TeleBirr Logo.svg`) |
| `mpesa` | M-Pesa | `mobile_money` | ETB | `#43B02A` | **Pending from user** (High-fidelity "MP" monogram badge active) |
| `awash` | Awash Bank | `bank` | ETB | `#005A9C` | Clean Vector SVG (`assets/BankIcons/Awash International Bank Logo.svg`) |
| `coop` | Cooperative Bank of Oromia | `bank` | ETB | `#72246C` | Clean Vector SVG (`assets/BankIcons/Cooperative Bank of Oromia Logo.svg`) |
| `ahadu` | Ahadu Bank | `bank` | ETB | `#0C3866` | Clean Vector SVG (`assets/BankIcons/Ahadu Bank Logo.svg`) |
| `amhara` | Amhara Bank | `bank` | ETB | `#C98A2C` | Clean Vector SVG (`assets/BankIcons/Amhara BankLogo.svg`) |
| `zemen` | Zemen Bank | `bank` | ETB | `#D51D4F` | Clean Vector SVG (`assets/BankIcons/Zemen Bank Logo.svg`) |
| `custom` | Custom / Other | `custom` | ETB | `#64748B` | Lucide `WalletCards` icon |

#### Bundled Asset vs. Database Storage Strategy
* **Bundled Assets:** Fixed provider logos are stored as app assets (cleaned SVGs in `assets/BankIcons/` and typed constants in `constants/bankLogosSvg.ts`). Rendered crisply at any size using `react-native-svg` `<SvgXml>`.
* **Zero Image BLOBs in SQLite:** The database stores only the stable `provider_id` string (e.g. `'cbe'`). It never stores raw binary image blobs, avoiding database bloat and backup degradation.
* **User-Provided Assets Directory:** `frontend/assets/wallets/` was created with a complete specification of expected file names (`cbe.png`, `boa.png`, `mpesa.png`, etc.).
* **SVG Cleaning:** All SVGs in `assets/BankIcons/` had injected `live-server` web scripts stripped, restoring them to pure XML standards.

---

### 2.5 Wallets Screen Implementation (`WalletsScreen.tsx`)
A complete vertical slice has been built and wired to Zustand and SQLite:
1. **Total Active Balance Card:** Displays the aggregated ETB balance across non-archived wallets.
2. **Provider Selector:** Modal horizontal picker with live logos and monograms.
3. **Wallet Creation:** Supports entering custom name, provider, legitimate opening balance, and optional masked last 4 digits.
4. **Wallet Editing:** Allows modifying name, updating opening balance (which recalibrates current balance via invariant), and setting default wallet.
5. **Safe Archiving & Deletion:**
   * Default wallets cannot be deleted or archived.
   * Wallets with recorded transactions are protected from deletion; users are prompted to archive them instead so financial history remains intact.
6. **Recent Activity Inspector:** Expanding any wallet card shows its 5 most recent transactions.

---

### 2.6 Visual Identity & Restrained Color Palette
* **Brand Identity:** BanKoni replaces MoniVo. Generic dollar-sign motifs and artificial wood textures are eliminated.
* **Current Active Tokens (`frontend/constants/theme.ts`):**
  * Dark Mode: Background `#080D18`, Surface `#121A28`, Champagne Accent `#C8A96B`, Subtle Gold `#8F7548`
  * Light Mode: Background `#F8F7F4`, Surface `#FFFFFF`, Champagne Accent `#B8943F`, Subtle Gold `#D4BC7C`
* **Proposed Forest Green & Gold System (Ready for Stage 2 Adoption):**
  * Primary / Stability: Deep Forest Green (`#133926` / `#1E4D36`)
  * Highlight / Accent: Warm Champagne Gold (`#C8A96B` / `#D4AF37`)
  * Dark Surface: Charcoal (`#0C1117`)
  * Light Surface: Warm Ivory (`#F9F8F5`)

---

### 2.7 Authentication & Settings Screen Verification
* **PIN Validation Unified:** Both `RegisterScreen.tsx`, `useBanKoniStore.changePin`, and `SettingsScreen.tsx` now uniformly invoke `validateNewPin` (requiring 6–12 numeric digits).
* **Settings Screen Accordions:** `SettingsScreen.tsx` compiles with zero errors, featuring Profile, Security, Preferences, and Data Backup accordions.
* **Biometric Guard:** Startup authentication preserves single-prompt gating without duplicate loops.

---

## 3. Test Verification Matrix

| Test Suite | Scope | Result |
|---|---|---|
| `test_migration_and_balances.py` | Fresh database initialization (zero opening balance, zero mock txs/budgets) | **PASS** ✓ |
| `test_migration_and_balances.py` | Idempotent restart (empty tables stay empty, no resurrected records) | **PASS** ✓ |
| `test_migration_and_balances.py` | Legacy V1/V2 migration with 0 transactions (12,450 phantom balance removed) | **PASS** ✓ |
| `test_migration_and_balances.py` | Legacy V1/V2 migration with user transactions (12,450 removed, real txs preserved) | **PASS** ✓ |
| `test_migration_and_balances.py` | Balance invariant ($balance = opening + net$) verification | **PASS** ✓ |
| TypeScript Compiler (`npx tsc --noEmit`) | Complete frontend codebase static type safety | **PASS** (0 errors) ✓ |
