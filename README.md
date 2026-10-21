<div align="center">

# BanKoni

**A local-first personal finance tracker for Android and iOS**

[![Expo](https://img.shields.io/badge/Expo-SDK%2057-000020?style=flat-square&logo=expo)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.86-61DAFB?style=flat-square&logo=react)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-see%20LICENSE-lightgrey?style=flat-square)](#license)

</div>

BanKoni is a personal finance app built with React Native and Expo. Money is tracked in Ethiopian Birr (ETB). All data is stored on the device in SQLite, with no account server and no cloud sync.

> **Note:** BanKoni was formerly known as **MoniVo**. The original project is available at [firaflash/expense-tracker](https://github.com/firaflash/expense-tracker). The repository folder is still named `MoniVO-`.

## Table of Contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Limitations](#limitations)
- [Security](#security)
- [Repository Layout](#repository-layout)
- [Getting Started](#getting-started)
- [Tech Stack](#tech-stack)
- [Documentation](#documentation)

## Screenshots

| Home | Transactions | Wallets |
| :---: | :---: | :---: |
| ![Home](docs/screenshots/home.png) | ![Transactions](docs/screenshots/transactions.png) | ![Wallets](docs/screenshots/wallets.png) |

| Budgets | Analytics | Settings |
| :---: | :---: | :---: |
| ![Budgets](docs/screenshots/budgets.png) | ![Analytics](docs/screenshots/analytics.png) | ![Settings](docs/screenshots/settings.png) |

> Screenshots are stored in `docs/screenshots/` and are displayed on GitHub only. They are excluded from the app bundle and from EAS uploads (see `.easignore`). See [`docs/screenshots/README.md`](docs/screenshots/README.md) for the expected file names.

## Features

- **Transactions:** Income and expense entries with category, wallet, date, and note, plus search and filtering.
- **Wallets:** Cash, bank, and mobile-money accounts with opening balances, a default wallet, archive and restore, and deletion safeguards.
- **Budgets:** Category budgets with date ranges and an optional wallet scope.
- **Analytics:** Spending charts and category breakdowns.
- **Categories:** Custom categories alongside the defaults.
- **Security:** PIN login with optional biometric unlock, plus light and dark themes.
- **Backup:** JSON export and share, and JSON restore.
- **Navigation:** Home, Transactions, Wallets, Budgets, Analytics, and Settings tabs.

## Limitations

BanKoni is intentionally scoped as a local-first tool. The following are not currently supported:

- **Bank integration.** Wallet providers such as CBE and Telebirr are represented as labels and logos only. Balances are never fetched from a financial institution.
- **Cloud sync and account recovery.** All data remains on the device.
- **SMS parsing.** Not yet implemented.
- **Background auto-lock.** Not verified.

## Security

- The PIN and biometric unlock control access to the app. The SQLite database itself is **not encrypted**.
- Exported JSON backups are **unencrypted** and contain sensitive financial data. Store and share them with care. Backups do not include the PIN hash.
- Restoring a backup **replaces** existing transactions, budgets, wallets, and custom categories. It does not merge data.

## Repository Layout

```text
.
├── README.md
├── .easignore               # Files excluded from EAS uploads
├── App.tsx, index.ts        # Entry points
├── app/                     # Screens and navigation
├── components/
├── constants/
├── db/                      # SQLite schema and repository
├── hooks/
├── security/                # PIN hashing
├── store/                   # Zustand store
├── types/
├── assets/                  # Only assets the app bundles
└── docs/
    ├── ARCHITECTURE.md
    ├── DEVELOPMENT.md
    ├── screenshots/         # README images (not bundled)
    └── design-source/       # Source artwork (not bundled)
        └── bank-icons/
```

## Getting Started

**Requirements:** Node.js 22.13 or later, and npm.

```bash
npm ci               # Install dependencies
npm start            # Start the Expo development server
npm run android      # Build and run on an Android device or emulator
```

For APK builds with EAS, see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). For an overview of how the codebase fits together, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Tech Stack

- **Framework:** Expo SDK 57, React Native 0.86, React 19
- **Language:** TypeScript
- **Navigation:** React Navigation
- **State management:** Zustand
- **Storage and security:** expo-sqlite, expo-secure-store, expo-local-authentication
- **UI:** react-native-svg

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Original project: firaflash/expense-tracker](https://github.com/firaflash/expense-tracker)

## License

See the [LICENSE](LICENSE) file for details.
