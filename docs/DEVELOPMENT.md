# Development

## Prerequisites

- Node **22.13+** (React Native 0.88 / Expo SDK 58 supports Node 22.13+, 24.3+, or 26+).
- **npm**. `package-lock.json` is authoritative; do not use yarn or pnpm. `.npmrc` sets `legacy-peer-deps=true`.
- Android: Android Studio or SDK, plus a device or emulator.
- iOS: macOS and Xcode only.

## Run

From the repo root:

```bash
npm ci
npm start            # expo start
npm run start:clean  # expo start -c (clear Metro cache)
npm run android      # expo run:android (native build)
```

The app has no server or API-key dependency. `.env.example` is a template only.

## Type-check

```bash
npx tsc --noEmit
```

## Build an Android APK (EAS)

Run from the repo root (where `eas.json` lives):

```bash
npx eas-cli build --platform android --profile preview     # installable APK
npx eas-cli build --platform android --profile production  # AAB, for Play Store
```

`.easignore` at the repo root replaces `.gitignore` for the upload. If you add a new ignore rule to `.gitignore`, add it to `.easignore` too.

## Measuring app size

Three different numbers get confused, so name which one you mean:

1. **JS bundle** (Hermes `.hbc`):
   ```bash
   npx expo export --platform android --output-dir dist/size --dump-assetmap
   ```
   `dist/` is git-ignored.
2. **Universal APK**, as produced by the `preview` profile. It contains native libraries for **all four ABIs**, which is why it is much larger than what a phone downloads.
3. **Per-device download size** from an AAB on Play, or from ABI-split APKs.

Only compare numbers from the same artifact type and the same revision.

## Project conventions

- Screens go in `app/(app)/` or `(auth)/`; shared UI in `components/`.
- Anything the app needs to display at runtime goes in `assets/`. That folder is bundled.
- README screenshots and raw design art go in `docs/`. They are outside the Metro root and excluded from EAS uploads. **Never import anything from `docs/`.**
- Do not change money, balance or PIN logic without tests or a written reason.
- Do not commit `.env`, keystores or `*.pem`.
