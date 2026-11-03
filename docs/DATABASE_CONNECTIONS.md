# SQLite connection ownership — Phase 1

## Verified starting point

The working tree was clean on branch `pichu`, commit
`3b05aa35c28a5a39458c50b919e1c31d95003391`. Installed versions were Expo
58.0.19 and expo-sqlite 58.0.14. This phase changes connection ownership only;
there is no schema/version migration or new dependency.

The installed SDK source, rather than a README assumption, establishes:

- `node_modules/expo-sqlite/src/SQLiteDatabase.ts:140–153`:
  `withTransactionAsync` runs BEGIN/task/COMMIT on the existing handle. Other
  async queries on that handle can join its transaction.
- `SQLiteDatabase.ts:180–204` and `797–803`: `withExclusiveTransactionAsync`
  creates a new native connection with `useNewConnection: true`, then executes
  BEGIN **before** invoking the application callback. The application cannot
  initialize foreign keys on that connection through the callback before BEGIN.
- `SQLiteDatabase.ts:600–614`: the public `openDatabaseAsync` API supports
  opening a new connection directly. No private SDK API is needed.
- Android `android/src/main/java/expo/modules/sqlite/SQLiteModule.kt:144–175`
  and iOS `ios/SQLiteModule.swift:125–153,223–227` (under expo-sqlite):
  `useNewConnection` bypasses cached connections. Native initialization adds an
  optional change hook; it does not copy the primary connection's PRAGMAs or
  enable foreign keys.

Previously, database initialization set foreign keys on the primary connection,
then used the SDK exclusive helper for schema work and multi-statement writes.
Those transaction connections were not explicitly configured. Some single
statement writes also used the primary connection directly. Configuring the
primary connection did not establish enforcement on all these paths.

## Ownership and ordering

`db/connectionOwner.ts` owns one process-lifetime reader and a queue of writes.
`db/database.ts` supplies the only production opener:

```ts
SQLite.openDatabaseAsync('bankoni.db', { useNewConnection: true })
```

Every connection follows this sequence, with each step awaited:

1. Open a fresh native connection.
2. Check `isInTransactionAsync()` is false; otherwise reject and close.
3. Execute `PRAGMA foreign_keys = ON;`.
4. Read `PRAGMA foreign_keys;` and require the numeric result `1`. Otherwise
   reject and close. No callback or BEGIN is reached on configuration failure.

The reader next sets WAL (as before) and `query_only = ON`. Only its query
methods are exposed by `getDatabase()`. This function now also awaits schema
initialization, so callers cannot race initialization. Concurrent initialization
requests share one promise; a failed attempt can be retried. The reader has no
application transaction and cannot accidentally participate in a writer's work.

Each queued write opens and verifies its **own** connection, executes
`BEGIN IMMEDIATE`, awaits its callback, commits, and closes. Callback/commit
failure attempts rollback before close and preserves the original error if
cleanup also fails. BEGIN failure closes without running the callback. A
rejected operation does not poison the queue.

Initialization uses the same owned write path directly, avoiding recursive
initialization. All repository writes, including formerly direct single
statement writes, use the queue. The schema SQL, constraints, financial
calculations, and JSON export/import implementations remain unchanged.

This does not substitute Expo's ordinary transaction helper for its exclusive
helper. It retains a dedicated connection per transaction. `BEGIN IMMEDIATE`
reserves SQLite's single writer before read/modify/write work. App writes wait
in order instead of colliding with one another. Reads on the separate WAL
connection see committed data, not the writer's intermediate balance updates.
External writers cannot join this transaction and may receive SQLITE_BUSY.

## Automated verification

Run from the repository root:

```sh
npm test -- --runInBand --watch=false --coverage=false
npm run typecheck -- --incremental false
```

The new tests have three explicit boundaries:

- `db/__tests__/connectionOwner.test.ts`: **mocked** SDK-shaped handles test
  ordering, configuration failures, shared/retryable initialization, BEGIN and
  COMMIT failures, rollback/close attempts, and queue recovery. These tests alone
  do not prove SQLite enforcement.
- `connectionOwner.sqlite.test.ts`: actual file-backed **host SQLite**, using
  Node's built-in `node:sqlite`. Each connection starts with foreign keys OFF.
  Tests observe foreign keys `1` and no active transaction immediately before
  every BEGIN; check valid/invalid foreign keys and read-only reader protection;
  verify full rollback and queue recovery; hold a writer while another app
  writer waits and the reader sees only committed data; and verify an independent
  SQLite connection cannot obtain the reserved writer lock.
- `database.sqlite.test.ts`: the actual repository/schema/SQL run against host
  SQLite through a small Expo-method adapter. Only Expo's opening/bridge is
  replaced. Tests cover shared initialization and failed-seed rollback/retry,
  valid/invalid budget wallet references, restricted parent deletion, transaction
  insert/edit/status/type/wallet/delete behavior (including fractional birr),
  rollback between row and balance updates, concurrent insert/delete/edit
  operations, and compatibility/atomic failure of the existing JSON restore.

The host tests use temporary directories and never open the application's vault.
Verified environment: Node 22.23.1, host SQLite 3.51.2. Node reports its built-in
SQLite API as experimental. These tests require a Node runtime with `node:sqlite`
and `DatabaseSync.isTransaction` (available in the tested runtime); older Node
versions allowed for running the app may need upgrading to run these tests.
There are no additional npm dependencies. The test fixture explicitly references
the Node types already installed with the existing development toolchain.

Results for this change:

- Full Jest suite: **19 suites passed, 156 tests passed, 0 snapshots**.
- New tests: **10 mocked lifecycle tests** and **12 actual host SQLite tests**
  (3 owner/isolation tests and 9 repository tests with the Expo bridge adapted).
- `npm run typecheck -- --incremental false`: **passed**, exit code 0.
- `git diff --check`: **passed**. No native-device tests were run.

## Native-device verification still required

No Android device/emulator or iOS runtime was available for this change. Host
SQLite tests do **not** prove Expo bridge behavior, the bundled native SQLite
build, native scheduling/resource cleanup, or device lifecycle handling.

On each supported native platform, use a development build with the installed
SDK and a disposable database filename, never the user's vault. Exercise the
production owner with an opener that calls `openDatabaseAsync(testFilename,
{ useNewConnection: true })`. Without adding screens or navigation:

1. Record open/PRAGMA/BEGIN order through an opener wrapper or debugger. Confirm
   the reader and every fresh writer read back foreign keys `1`, and verification
   completes before BEGIN. Check again inside each transaction. Confirm distinct
   native handles and that no exclusive SDK helper opens an unconfigured handle.
2. Create parent/child tables. Insert a valid child successfully. Attempt a child
   with a missing parent, and delete a referenced parent; both must fail with an
   FK constraint error. `PRAGMA foreign_key_check` should return no violations.
3. Throw after updating a wallet and before inserting/updating/deleting the
   related transaction. Confirm both tables retain their prior committed values.
   Repeat for a failed initialization and then retry.
4. Hold a write callback after its first update, issue a second app write, and
   read from the reader. The second callback must wait, and the reader must see
   only the first operation's prior committed state. Release, await both, and
   compare balances with committed ledger effects. Repeat concurrent edits and
   deletes and inject one failure.
5. While the writer is held, attempt BEGIN IMMEDIATE on a separate native handle.
   It must not enter a second write transaction. Close it, finish the first
   transaction, and verify later writes still work. Confirm writer handles close
   after success and all failure paths, and reader setup permits WAL writes.
6. Smoke-test existing transaction add/edit/delete, wallet and budget actions,
   profile/security persistence, and valid JSON backup/restore. Background/resume
   and restart the app, then recheck connections and FK enforcement.

Record platform/build, SQLite version, observed values/errors, SQL ordering,
balances, and resource cleanup results. Device verification has not been claimed
as completed.

## Remaining limits and preservation

- The write queue belongs to this module's owner in one JS runtime. Future
  background tasks or other runtimes must use their own configured connections
  and handle SQLite contention. There is no automatic busy retry.
- Transaction callbacks must use the provided handle, await their SQL, and not
  nest/enqueue another owned transaction and await it (that would deadlock).
  Current repository callbacks follow this rule.
- The reader remains open for the application process lifetime, as the primary
  connection did before. Fast refresh/native lifecycle resource handling still
  needs the device checks above. Opening a dedicated writer per operation adds
  overhead, as the previous exclusive helper also did.
- Enabling foreign keys does not repair historical orphan rows or add constraints
  absent from legacy schemas. A future integrity/migration phase must inspect
  those explicitly. Existing invalid parent operations may now fail; no FK is
  removed, weakened, or deferred to accept them.
- If native close fails after a successful COMMIT, the caller receives the close
  error even though data committed (also possible with the SDK helper). Do not
  blindly retry a non-idempotent operation. Severe storage/bridge failures during
  both rollback and close cannot be proven recoverable by mocks.
- Export still reads multiple tables without a single snapshot. Restore's
  validation, replacement policy and format are unchanged. Those are separate
  phases; this change supplies their owned, FK-enforced transaction path.
- No navigation, screen, UI component, monetary unit/type, financial calculation,
  SMS parser, PIN/biometric algorithm, backup policy, or encryption was changed.
  Profile/security write statements were only routed through the owner so there
  is no bypass for database writes. No Git staging/commit/push is part of this work.
