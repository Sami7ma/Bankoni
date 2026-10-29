<div align="center">

# BanKoni

**A local-first personal finance tracker for Android and iOS**

[![Expo](https://img.shields.io/badge/Expo-SDK%2058-000020?style=flat-square&logo=expo)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.88-61DAFB?style=flat-square&logo=react)](https://reactnative.dev)
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

- **Framework:** Expo SDK 58, React Native 0.88, React 19.3.0
- **Language:** TypeScript 6
- **Navigation:** React Navigation v7
- **State management:** Zustand
- **Storage and security:** expo-sqlite, expo-secure-store, expo-local-authentication
- **UI:** react-native-svg, react-native-reanimated, react-native-safe-area-context

## Expo SDK 58 & iOS 27 Migration

BanKoni was upgraded from Expo SDK 57 (React Native 0.86.3, React 19.2.3) to **Expo SDK 58** (React Native 0.88.0, React 19.3.0) for full compatibility with **iOS 27**.

### Why SDK 58 for iOS 27?
- **UIKit Scene-Based Life Cycle:** iOS 27 requires the scene-based application lifecycle (`SceneDelegate.swift` and `UIApplicationSceneManifest` in `Info.plist`). Expo SDK 58 Continuous Native Generation (CNG) adopts scene lifecycle management natively.
- **Scene-Aware Geometry:** Deprecates reading geometry from `UIScreen.main` in favor of scene-aware window dimensions, supporting resizable windows and split views.
- **Safe Area Insets:** Updated `react-native-safe-area-context` (~5.10.1) handles iOS 27 insets and edge rails.

### Updated Dependencies
All Expo-managed packages were aligned using `expo install --fix`:
- `expo`: `^58.0.0`
- `react-native`: `0.88.0`
- `react`: `19.3.0`
- `react-native-safe-area-context`: `~5.10.1`
- `react-native-screens`: `~4.30.0`
- `react-native-gesture-handler`: `~3.3.0`
- `react-native-reanimated`: `4.7.1`
- `react-native-svg`: `15.16.0`
- `react-native-worklets`: `0.13.0`
- `expo-sqlite`: `~58.0.14`
- `expo-crypto`, `expo-document-picker`, `expo-file-system`, `expo-font`, `expo-linear-gradient`, `expo-local-authentication`, `expo-secure-store`, `expo-sharing`, `expo-splash-screen`, `expo-status-bar`
- Development dependencies: `expo-doctor@^1.21.5`, `@types/react@~19.3.0`

### Code and Configuration Changes
- **React Native 0.88 Strict TypeScript API:** Migrated `ViewToken` in `app/(auth)/OnboardingScreen.tsx` to `ListViewToken` from `react-native`.
- **App Configuration (`app.json`):** Removed deprecated top-level `"splash"` object (managed via `expo-splash-screen` plugin) and standardized icon paths to square assets (`assets/icon.png`).
- **Audit Verification:** Confirmed 0 usages of removed APIs (`InteractionManager`, root `Touchable`, `NativeMethods`, `Modal.animated`, deprecated `StatusBar` props, or internal `Libraries/*` imports).
- **SQLite Database Integrity:** Preserved all local schemas, transactions, wallets, and queries intact (`SQLite.openDatabaseAsync`).

### Verification & Testing
- **TypeScript:** `npm run typecheck` (`tsc --noEmit`) passes with 0 errors.
- **Test Suite:** `npm test` runs 14 test suites, 101 tests passing.
- **Expo Doctor:** `npx expo-doctor` 20/20 checks passed with 0 issues.
- **Metro Production Bundling:**
  - iOS: `expo export -p ios` bundled 3582 modules successfully into Hermes Bytecode (`.hbc`).
  - Android: `expo export -p android` bundled 3579 modules successfully into Hermes Bytecode (`.hbc`).

### Running the Upgraded App
- **Android:** Run `npm start` and press `a`, or build a preview APK with `npx eas-cli build -p android --profile preview`.
- **iPhone (iOS 27):**
  - **Expo Go:** Note that the public App Store release of Expo Go for SDK 58 follows the official SDK release by a few weeks. If the installed Expo Go app on the device reports an SDK mismatch, use a development build.
  - **Development Build (Recommended for SDK 58):** Build an iOS development client via EAS (`eas build --platform ios --profile development`) and install it onto the iPhone, then start the dev server with `npm start`.
  - **Local Xcode Build (macOS only):** If building locally on a Mac, run `npx expo run:ios`. (On Linux/Windows, local iOS compilation is not available; EAS remote builds must be used).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Original project: firaflash/expense-tracker](https://github.com/firaflash/expense-tracker)

## License

See the [LICENSE](LICENSE) file for details.
