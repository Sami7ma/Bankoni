# Automatic SMS Import in BanKoni

Implementation and verification record for the existing application. This is not a separate SMS application.

## Repository audit

- Expected `/home/Sami/Documents/MoniVO-/` was absent. Worked in `/home/Sami/Documents/Bankoni`, the existing `bankoni-mobile` application (display name BanKoni; Android/iOS identifier `com.sami7ma.bankoni`).
- Branch `pichu`; initial HEAD `3b05aa35c28a5a39458c50b919e1c31d95003391`.
- Complete initial status: [verification/sms-initial-git-status.txt](verification/sms-initial-git-status.txt). There were no staged changes; ten modified tracked files and the listed untracked financial-intelligence work were present. All were preserved. An additional binary diff safety copy was saved to `/tmp/bankoni-user-work-before-sms.patch`. No reset, clean, stash, branch switch, commit or push.
- Installed Expo 58.0.19, React Native 0.88.0, React 19.3.0. `index.ts` registers the app; `App.tsx` provides safe-area context; `app/navigation/AppNavigator.tsx` gates onboarding/login/main tabs. Zustand owns foreground state; the repository owns the single local SQLite vault, foreign-key guards, serialized write connections, and atomic transactions.
- Initially no generated Android/iOS directories. Expo config already identified both native apps and included SQLite, SecureStore, LocalAuthentication and file import/export plugins. Native projects are generated/ignored, with the durable implementation kept in a local Expo module and config plugin.
- Reused `sms/index.ts`, classifier, cleaners/integer santim parsing, provider detector, CBE, Telebirr, Dashen, BOA, Awash and M-PESA parsers; retained CBE Birr non-ledger handling. Added detection for the exact CBE fee-template message when the sender header/footer does not name CBE. Reused wallet matching, account registry, transfer correlation, merchant/education recognition, transaction/transfer repository, manual review modal and the existing Settings design/theme.
- The pre-existing manual SMS modal parsed/reviewed/persisted transactions. It did not read an inbox or receive messages. Historical scanning, native reception, durable recovery and iOS Shortcut integration were absent. Fingerprint/reference deduplication existed; references were globally unique, which could incorrectly suppress opposite transfer legs or independent providers.

## Reference investigation

No `totals.js` attachment was exposed in this conversation or found in the workspace, expected directory, Documents or `/tmp`. Consequently its `parseSmsText()`, `sms_patterns.json`, queue and persistence implementation could not be verified. Do not attribute an implementation detail to that unseen file.

The [reference video](https://youtu.be/ZKHeKu32o7w) resolved to “Set Up Totals on iOS”, but the available page exposed no video content/transcript. Both watch and timed-text endpoints were attempted; no transcript was retrieved. The video was not watched. The architecture here uses Apple's and Android's documented integration mechanisms, not an unverified copy of Totals or a Scriptable dependency.

Relevant primary sources:

- [Apple Message communication triggers](https://support.apple.com/en-ae/guide/shortcuts/apdd711f9dff/ios): Message sender/contains criteria; multiple criteria are ANDed.
- [Apple App Intents packages](https://developer.apple.com/documentation/appintents/appintentspackage): framework intent discovery through the app's included package.
- [Apple App Intents execution](https://developer.apple.com/videos/play/wwdc2022/10032/): actions can run without opening the app; the property alone is not device-test evidence.
- [Apple default-app updates](https://developer.apple.com/documentation/updates/defaultapps), [TelephonyMessagingKit scope in the Developer Program agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/): carrier messaging privileges and history concern messages handled by the default carrier messaging application, not general access to an existing Messages inbox.
- [Apple Message filtering](https://developer.apple.com/documentation/identitylookup/sms-and-mms-message-filtering): an incoming unknown-sender filtering API, not an inbox/history API. It is not used as a way to extract private message history.
- [Android SMS broadcasts](https://developer.android.com/reference/android/provider/Telephony.Sms.Intents), [background tasks](https://developer.android.com/develop/background-work/background-tasks), [Doze](https://developer.android.com/training/monitoring-device-state/doze-standby).
- [Google Play SMS permissions](https://support.google.com/googleplay/android-developer/answer/10208820): SMS-based money management is a listed exception, subject to declaration, eligibility and review. Sideloading does not guarantee that an installer/device permits restricted SMS permissions. Do not become the default SMS handler just to bypass this policy.

## Implementation map

- `sms/automatic/plan.ts`: pure shared financial decisions and integer-santim arithmetic; conservative review gates, existing provider parsers/account matching, category recognition, principal/fee plans, durable receipt SQL.
- `db/transactionSql.ts`: the canonical transaction insert reused by the existing repository and native iOS execution. Raw SMS is not inserted by this path.
- `db/database.ts`: schema version 2, additive `sms_import_receipts`, account/direction-scoped case-insensitive reference guards (triggers preserve pre-existing case-variant rows), atomic automatic transaction/fee/balance/receipt handoff. Existing transaction insert now uses the shared statement. Existing `createTransferDB` accepts idempotent SMS evidence/fingerprints/receipts for confirmed pairs.
- `sms/automatic/processor.ts`: bounded queue draining, one drain at a time, automatic persistence via the repository, foreground/manual-import duplicate recognition, retry-safe handoff. Queue reviews also commit a receipt atomically through the existing store transaction action, including edited amounts.
- `sms/automatic/native.ts`: typed local native queue contract; Expo Go availability is explicit.
- `sms/automatic/transfers.ts`: bounded, account-aware transfer suggestions and user-confirmed linking through `createTransferDB`.
- `sms/automatic/exportedMessages.ts`: validated, explicitly selected JSON message exports (5 MB, 10,000 rows, prior twelve months).
- `sms/transferCorrelator.ts`: removed invented ETB 12 defaults when fees have no supporting evidence; retained the existing user's correlation implementation. Automatic processing treats its uncertain ownership inference as review, not proof.
- `modules/bankoni-sms/android`: native SMS prefilter; multipart receiver; app-private SQLite queue excluded from backup; resumable keyset historical scan; WorkManager recovery and bounded ReactHost/Headless JS execution. No Activity or foreground listener is needed for reception.
- `modules/bankoni-sms/ios`: App Intent, private durable queue, SQLite adapter, JavaScriptCore executor, and discretionary background refresh recovery. The financial plan/SQL comes from the shared TS engine. The existing vault and its constraints remain authoritative.
- `scripts/build-sms-engine.cjs`: hermetic local TypeScript-to-JavaScript bundle for JavaScriptCore. No server, AI service or remote pattern JSON is used.
- `plugins/withAutomaticSms.cjs`: regenerates the rules bundle, connects framework App Intent metadata/Shortcuts provider into the generated iOS target, and configures background refresh. Local Expo module autolinking supplies Android manifest components and permissions.
- `app.json`, `package.json`, `package-lock.json`: register the config plugin and shared-engine build script, and declare the exact local Babel build dependencies. `modules/bankoni-sms/package.json`, `expo-module.config.json`, Android Gradle/manifest and the iOS podspec describe the actual autolinked native module.
- `index.ts`, `App.tsx`: Headless JS registration; unlocked foreground recovery and store refresh. Visible transaction/balance data refreshes after native imports using a lightweight count check while active; this polling is for UI refresh, not background reception. No PIN or biometric behavior is weakened.
- `components/settings/AutomaticSmsImport.tsx`, `app/(app)/SettingsScreen.tsx`: setup, consent, permissions/status, accounts, history progress/counters, retries, export selection, review/dismiss, confirmed transfer pairs.
- `components/modals/SmsImportModal.tsx`, `store/useBanKoniStore.ts`: queue-message prefill and original reception timestamp/sender in the existing review flow; preserved all existing financial review features.
- `modules/bankoni-sms/.gitignore`, `.easignore`: exclude native module intermediates from source control/build uploads while retaining the shared engine resource.
- `tsconfig.json`: excludes generated native projects/build caches from TypeScript source discovery.
- Tests: `sms/automatic/__tests__/plan.test.ts`, `db/__tests__/automaticSms.sqlite.test.ts`, and Android `src/test/java/com/bankoni/sms/SmsQueueTest.kt`.

## Android behavior

1. Explicit enable consent precedes READ_SMS and RECEIVE_SMS requests. BOOT_COMPLETED and WAKE_LOCK are normal manifest permissions for recovery/work scheduling; no SEND_SMS or default-handler role is requested.
2. The first enable starts twelve-calendar-month inbox scanning. A fixed lower/upper bound, `(date, _id)` checkpoint, scanned count, filtered count and total are durable. At most 200 rows are handled per unit. Queue inserts and checkpoint advance commit in the same native SQLite transaction; a killed batch rolls back and can replay safely.
3. SMS_RECEIVED joins multipart PDU bodies, filters OTP/personal messages, and persists financial candidates before scheduling work. History uses the provider's sent timestamp where available to match the live PDU identity; receipt time is the scan cursor. Message identity also includes sender and normalized content.
4. WorkManager starts the existing ReactHost without an Activity, then runs registered `BanKoniSmsImport`. The shared TS processor opens BanKoni's database and commits financial records. A periodic 15-minute recovery request complements one-time jobs; Android determines actual scheduling.
5. Completed scans continue incrementally from their saved cursor during later work, periodic recovery, and app reopening. This catches inbox messages missed while stopped or during reception races without repeating the entire history. Catch-up counters describe that incremental run. Queue leases survive interruption. Temporary failures keep their evidence until resolved and retry automatically with exponential delays from five minutes up to one day; explicit retry resets the delay. Repeated process interruption also recovers through the durable lease. Parse/ownership/account uncertainties remain review items rather than being retried forever. Review text expires 30 days after ingestion, not after the original SMS date. An explicit historical rescan or selected file export can restore expired review evidence; deliberately dismissed and already imported messages stay deduplicated. Native-level duplicate deliveries are included in the skipped-duplicate statistics. Imported/duplicate/skipped text is erased immediately; minimal metadata remains.
6. Rescan resets scan progress, not deduplication. Live/history/provider redelivery is protected by the native identity, deterministic financial fingerprint, scoped provider reference, SQLite fingerprint/receipt constraints, reference triggers and atomic receipt.
7. Doze, battery restrictions, permission revocation, force-stop, a switched-off device and manufacturer restrictions can defer/prevent reception or processing. Force-stop requires reopening the app. A bank SMS sender is not cryptographic proof of a transaction. Immediate delivery under every device condition is not guaranteed.

### Android setup

1. Install the native APK, open BanKoni and complete the existing vault/PIN setup. Expo Go cannot receive SMS through this module.
2. In Wallets, connect each supported bank/mobile-money wallet and its account ending. Set opening balances consistently with the records being imported; historical SMS balances do not overwrite wallet balances.
3. Open Settings → Automatic SMS Import, enable it, accept the on-device processing explanation and grant both SMS permissions. The initial twelve-month scan starts automatically.
4. Monitor scanned/total, imported, duplicate, skipped, review and failed counters. Review uncertain transactions and explicitly confirm suggested transfers only when both messages belong together.
5. After an interruption, reopen BanKoni; the durable checkpoint and queue resume. Use Resume scan / check permissions if access was revoked, Retry for temporary failures, or Rescan previous 12 months to intentionally repeat the scan with deduplication retained.
6. Receive a real financial SMS to validate delivery on the target device. If the installer withholds restricted SMS permissions, use an installation/distribution channel that is permitted to grant them. Force-stop requires reopening the app.

## iOS behavior and setup

BanKoni and supported Shortcut actions cannot enumerate the previous twelve months of the Apple Messages inbox. Apple's newer TelephonyMessagingKit is a separate entitlement/default-carrier-messaging-app model: it handles messages sent/received by that application, not a budget app's backfill of the existing Messages database. BanKoni is not converted into a replacement messaging app. Incoming Message automation is a separate supported capability. The historical alternative implemented here is an already available, legitimately obtained message export chosen by the user, not an unsupported Messages database extraction.

1. On iOS 17 or later, install a native BanKoni build containing the module, unlock/setup the vault, and connect bank/mobile wallets with their account endings in Wallets.
2. Settings → Automatic SMS Import → enable and accept on-device append-only import consent.
3. Open Apple Shortcuts and create **BanKoni SMS Import**. Add **BanKoni → Import Bank Message**. Message = **Shortcut Input**, as Text/message Content. Sender may be blank, or the Message input's sender. If the original Message date is available in that iOS version, pass it to optional **Received At** to improve timestamp consistency.
4. Create an incoming **Message** automation for bank senders, or **Message Contains ETB**. If different formats use “Birr”/“ብር”, create additional matching automations as needed. Multiple criteria within one automation must all match. Choose **Run Immediately**, or turn off the corresponding confirmation setting for your iOS version.
5. Run Shortcut → BanKoni SMS Import, with the received Message/Content as input. No “Ask for Input”, clipboard paste, Scriptable, URL opening, or external upload action is involved.
6. Send/receive a real supported bank message to verify automation. Initially approve the action's permissions if Shortcuts asks. iOS versions expose automation creation in different places; use the Message automation/trigger, not a generic notification read workaround.

`Import Bank Message` durably queues before invoking the shared TS plan through JavaScriptCore and committing to the existing vault. It does not set `openAppWhenRun` to true, expose financial data in its return value, or unlock the BanKoni UI. Background refresh is an additional discretionary recovery opportunity; foreground recovery/retry always exists. Lock-state/file-protection rules remain in force. App Intent discovery, locked execution and Shortcuts automation still require Xcode/iPhone validation; source settings are not proof of a silent background run.

There is **no signed installable .shortcut or iCloud installation URL** in this delivery. Signing/import/publication require an Apple Shortcuts installation/device/account unavailable here. The native action is the integration; the exact action/automation recipe above is the remaining installation step. No fabricated download is presented.

JSON historical export format (UTF-8):

```json
[{"body":"<complete financial message>","sender":"CBE","receivedAt":"2026-11-01T05:38:24Z"}]
```

`receivedAt` may instead be epoch milliseconds. The picker copy is removed from BanKoni's cache after reading; source files are not altered. Export must already exist through a legitimate user-controlled process. This feature does not create an iOS inbox export.

## Financial correctness

The supplied CBE debit parses principal 37,000 santim; service charge 1,000; VAT 150; disaster recovery 50; fees 1,200; ledger reduction 38,200. Telebirr parses incoming 37,000, reference DK17JQBOW5 and balance 37,675 santim. The CBE message has neither reliable reference nor destination; amount/provider evidence alone cannot establish ownership.

Both messages remain review items. With connected matching account endings and a time difference of at most ten minutes, Settings offers a suggestion. The user sees both original messages, wallets, principal, fees and total, and confirms. One existing repository transaction writes two ETB 370 transfer legs, a separate ETB 12 fee, the transfer relationship, both fingerprints and both receipts. Retrying that confirmation returns the same transfer. With example opening balances CBE 368,052.94 and Telebirr 6.75, balances become CBE 367,670.94 and Telebirr 376.75. Only the fee is spending; the principal is neither income nor a personal purchase.

Automatic ordinary imports use integer santim for principal/fee/delta decisions and store values through the existing ETB-denominated schema. They add deltas rather than overwriting current wallet balances with historical SMS balance snapshots. Correct initial/current balances still require appropriate wallet opening balances and a complete set of records; scanning a partial year cannot infer every pre-existing balance.

Reference uniqueness is scoped to wallet and direction; fingerprints include provider, account, amount, reference/date/balance evidence. Similar amount alone is never an automatic transfer link. Uncertain parsing, conflicting accounts, missing usable amounts and unregistered providers go to review. Identical no-reference messages with indistinguishable timestamps/content cannot always be distinguished from redelivery; passing original message dates improves that evidence.

## Verification

See [verification/SMS_RESULTS.md](verification/SMS_RESULTS.md) for the actual final results. Unit/static/Metro/prebuild success must not be reported as native or physical-device success.
