# BanKoni

A local-first personal finance tracker for Android and iOS, built with React Native and Expo. Money is tracked in **ETB (Ethiopian Birr)**. All data lives on the device in SQLite, with no account server and no cloud sync.

> Formerly "MoniVo". The repository folder is still named `MoniVO-`.

## Screenshots

Screenshots live in [`docs/screenshots/`](docs/screenshots/) and are shown here on GitHub only. They are never imported by the app and are excluded from EAS uploads (see [`.easignore`](.easignore)), so they add **nothing** to the APK/AAB.

| Home | Transactions | Wallets |
|:---:|:---:|:---:|
| ![Home](docs/screenshots/home.png) | ![Transactions](docs/screenshots/transactions.png) | ![Wallets](docs/screenshots/wallets.png) |

| Budgets | Analytics | Settings |
|:---:|:---:|:---:|
| ![Budgets](docs/screenshots/budgets.png) | ![Analytics](docs/screenshots/analytics.png) | ![Settings](docs/screenshots/settings.png) |

See [`docs/screenshots/README.md`](docs/screenshots/README.md) for the expected file names.

## Features

- Income and expense transactions with category, wallet, date and note; search and filtering.
- Wallets (cash, bank, mobile-money providers) with opening balances, a default wallet, archive/restore and deletion safeguards.
- Category budgets with date ranges and an optional wallet scope.
- Spending charts and category breakdowns.
- Custom categories.
- PIN login with optional biometric unlock; light and dark themes.
- JSON export/share and JSON restore.

App tabs: **Home, Transactions, Wallets, Budgets, Analytics, Settings**.

### What it does not do

- No bank integration. Wallet "providers" (CBE, Telebirr, and so on) are labels and logos only. Balances are never fetched from a real bank.
- No cloud sync or remote account recovery.
- No SMS parsing yet.
- No verified background auto-lock.

### Security notes

- The PIN and biometrics gate access to the app. The SQLite database itself is **not encrypted**.
- Exported JSON backups are **unencrypted** and contain sensitive financial data. They do not include the PIN hash.
- Restoring a backup **replaces** transactions, budgets, wallets and custom categories. It does not merge.

## Repository layout

```
.
├── README.md
├── .easignore               # what EAS uploads; keeps docs/ out of builds
├── App.tsx, index.ts        # entry points
├── app/                     # screens + navigation
├── components/
├── constants/
├── db/                      # SQLite schema and repository
├── hooks/
├── security/                # PIN hashing
├── store/                   # Zustand store
├── types/
├── assets/                  # only what the app actually bundles
└── docs/
    ├── ARCHITECTURE.md
    ├── DEVELOPMENT.md
    ├── screenshots/         # README images only (not bundled)
    └── design-source/       # raw source art (not bundled)
        └── bank-icons/
```

## Quick start

Requires Node 22.13+ and npm.

```bash
npm ci
npm start            # Expo dev server
npm run android      # build and run on an Android device or emulator
```

Full details, including building an APK with EAS, are in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). How the code fits together is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Tech stack

Expo SDK 57 · React Native 0.86 · React 19 · TypeScript · React Navigation · Zustand · expo-sqlite · expo-secure-store · expo-local-authentication · react-native-svg
