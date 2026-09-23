# What hangar writes twice (outside `#libs/widgets`)

This pass looks only for repeated code, missing sharing and dead code in everything except
`src/libs/widgets`, which `widgets-duplication.md` already covers. That report's §1, the
Arcane/Docker metric grid, **is still open**.

Findings are ranked by lines removed per line added. None of them is a bug. It is code that
exists twice and can only drift apart. The codebase is already lean: `apiRoute`, `apiStream`
and `sseStream` hold every API route's boilerplate. The total is roughly **250 lines out**,
with no new abstraction wider than one file or folder.

**Status.** §§2-5, 9, 10, 12, 13, 15 and the dead code are applied. Three differ from the
proposal: §4 became a `useYamlEditor` hook (editor element + save), because the settings card
keeps its button in a `CardFooter` and `AppEditor` does not; §12 keeps an empty `hangar.yml` a
schema error; `HangarEnv.required()` stays, since five tests of the variable scanner go
through it.

Measured: those items came out roughly **flat in line count** (−171 in existing files, +179 in
four new ones). The gain is one copy of each rule rather than fewer lines — `PendingButton` in
particular costs more at its call sites than the ternaries it replaces. Most of the ~250 lines
estimated above sit in the items still open, §1 above all.

---

## Components

### 1. The three filter wrappers repeat what `apps-overview` already holds (−55)

- **Where:** `apps-status-filter.tsx`, `apps-update-filter.tsx` and `apps-category-filter.tsx`.
- **Same code:** each is about 30 lines built on the same pattern:
  `useSearch_UNSTABLE({ from: "/apps" })`, then `useSetSearch_UNSTABLE`, then map the options
  into `CheckboxFilterMenu`. `apps-overview.tsx:41` already holds `setSearch`.
- **Fix:** delete the three files. Read the search once in `apps-overview` and render
  `CheckboxFilterMenu` three times inline. Keep the client hook rather than the `search`
  prop, or the checkboxes lag behind the server round-trip. Move `updateLabel` into
  `status.ts`.

### ✅ 2. The compose dialogs are wired twice (−30)

- **Where:** `apps-table.tsx:71-81,165-179` and `project-actions.tsx:17-46`.
- **Same code:** both build the same `confirmationTitle` and `confirmationDescription` maps
  (they differ only in singular vs plural). Both render the same `ComposeConfirmDialog` and
  `ComposeOutputSheet`, down to `label={running ? actionLabel[running] : ""}`.
- **Fix:** add `ComposeRunDialogs({ compose, subject, many })` in `compose-operations.tsx`,
  taking what `useComposeRun` returns. `ProjectActions` shrinks to about 8 lines.

### ✅ 3. The two stream sheets share a body (−15)

- **Where:** `compose-output-sheet.tsx` and `container-logs-sheet.tsx`.
- **Same code:** the header with its status badge
  (`status === "error" ? "destructive" : "secondary"`), the
  `min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-3` viewport and its `<pre>`, and the
  effect that scrolls to the bottom.
- **Fix:** add `StreamOutput` and `StreamStatusBadge` beside `use-stream-text.ts`. The logs
  sheet keeps its follow and reconnect logic.

### ✅ 4. The YAML editor with its inline error, twice (−12)

- **Where:** `config-settings-card.tsx:21-52` and `store/app-editor.tsx:26-65`.
- **Same code:** the same `useState(source)`, the same
  `setError(result && !result.success ? …)`, the same `CodeEditor` and the same
  `<pre className="… text-destructive">`.
- **Fix:** the settings card renders `AppEditor`'s editor part. The id field stays in
  `AppEditor`.

### ✅ 5. The pending button, five times (−12)

- **Where:** `config-settings-card.tsx:50` and `env-settings-card.tsx:128` are
  character-identical: `{isPending ? <Spinner/> : <SaveIcon/>}{isPending ? "Enregistrement…" : "Enregistrer"}`.
  `app-editor.tsx`, `store-settings-card.tsx` and `auth-form-card.tsx` follow the same
  pattern.
- **Fix:** add `PendingButton({ pending, icon, pendingLabel, …buttonProps })` in `common/`.

### 6. The auth submit, twice (−12)

- **Where:** `login-form.tsx:13-36` and `register-form.tsx:16-48`.
- **Same code:** the same
  `try { result = await authClient…; if (result.error) …; router.replace } catch … finally setIsPending(false)`.
- **Fix:** add a `useAuthSubmit()` hook. Sign-out in `navbar.tsx` reports through a toast, so
  leave it alone.

### 7. Two `formatBytes` (−8)

- **Where:** `components/apps/format.ts:4` (French, KiB, `null` gives "—") and
  `libs/widgets/shared/format.ts:13` (KB). Both use the same log-base-1024 algorithm.
- **Fix:** keep one in `#libs/format`. The app handles `null` at its call site.
- **Decision needed first:** which unit labels win, KiB or KB.

## App server side

### 8. The compose route notifies twice (−12)

- **Where:** `pages/_api/api/docker/apps/compose.ts:70-86` has two `notifications.notify({…})`
  calls that differ only in level, title and description. `actions/store/manage-store.ts:22-39`
  has the same pair.
- **Fix:** `try`/`catch` only sets `ok`, then one `notify` call follows. Keep the fix inside
  each file.
- **Side effect:** a throwing success notification no longer counts as a failed command.
  That is arguably more correct.

### ✅ 9. `installApp` and `uninstallApp` open with the same lookup (−10)

- **Where:** `install-app.ts:9-18` and `uninstall-app.ts:9-18`. Both run `requireSession`,
  then `hangar.store.app(id)`, then `warn` and `failure(…)`, and both have the same seven
  imports.
- **Fix:** one `store-apps.ts` file with a local `findApp`.

### ✅ 10. `refuseAppOperation` validates twice (−6)

- **Where:** `compose.ts:29` already narrows with `isAppOperation`, and
  `app-operations.ts:28` checks it again.
- **Stale comment:** the comment at `app-operations.ts:22` still mentions a server action
  that was deleted.
- **Fix:** take `operation: AppOperation`, drop the second check, and un-export
  `AppOperationRefusal`.

### 11. `search-codecs.ts` splits and joins lists by hand (−6)

- **Fix:** add local `readList` and `writeList` helpers for the split-filter parsing (three
  sites) and the `if (x.length) params.set(k, x.join(","))` writes (four sites).

## Libraries

### ✅ 12. `HangarConfig` reads its file twice (−12)

- **Where:** `hangar-config.ts:70-86` (`load`) and `:95-98` (`source`) each call `readFile`
  and each catch `ENOENT`. The missing-file branch also re-assigns the field defaults.
- **Fix:** `load()` goes through `source()`:
  `this.apply(s ? this.parse(s) : configSchema.parse({ categories: [] }))`.
- **Side effect:** an empty `hangar.yml` becomes "no config" instead of a schema error.

### ✅ 13. `ComposeProjects.summaries` builds the empty aggregate twice (−9)

- **Where:** `compose.ts:212` and `:229`.
- **Fix:** seed the map from `installed` first, then `projects.get(project)` and skip if it
  is missing. The second loop and the `installed.has` check both go.

### 14. The jobs build their dependencies twice (−6)

- **Where:** `check-image-version.ts:20` and `update-outdated-apps.ts:21`, both
  `new Docker(new Dockerode(), hangar.store)` and `new Notifications(db)`, with the same
  comment.
- **Fix:** add `jobs/jobs/deps.ts` with `jobDocker()` and `jobNotifications()`, and write the
  comment once.

### ✅ 15. Smaller repeats

- **Relative-time thresholds:** `relative-time.ts` writes `60/3600/86400/2592000` twice. Add
  the Intl unit name to `COMPACT_UNITS` and use one `findIndex` (−3).
- **Pinned digest check:** `docker.ts:230` and `:250` both test `@sha256:`. Use one
  module-level `pinned()` (−2).
- **Zod issue formatting:** `env.ts:24` and `hangar-config.ts:128` format issues by hand.
  `z.prettifyError` replaces both, but the output wording changes.

## Tests

- **`vi.mock("server-only", () => ({}))` in 7 files.** Replace it with one alias in
  `vitest.config.ts` to `server-only/empty.js`, which is what the package itself serves under
  `react-server`. `docker.test.ts` does not need the mock at all, since `docker.ts` has no
  guard, and its `await import`s can become static imports.
- **`mkdtemp` + `rm` four times** across the `hangar-*` tests. `hangar-config.test.ts` never
  cleans up, so it leaks temp dirs. Add a `tempDir(prefix)` helper that cleans up with
  `onTestFinished`, in a `#libs/hangar/mock` entry point.

## Dead code and misplaced code

| What                                                     | Where                                                              | Action                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `peekOutdatedProjects`                                   | `jobs/report.ts:27`                                                | No caller. Delete.                                                                                                     |
| `HangarEnv.required()`                                   | `hangar-env.ts:165`                                                | Only its test calls it. Delete both.                                                                                   |
| `HangarStore.create`                                     | `hangar-store.ts:80`                                               | An async wrapper around a private constructor. Make the constructor public; `Hangar.create` can then stop being async. |
| `MIGRATIONS_FOLDER` export, stale `../client.ts` doc     | `db/utils/migrate.ts:11-15`                                        | Un-export it and fix the comment.                                                                                      |
| `StoreSearch`, `StreamStatus`                            | `search-codecs.ts:5`, `use-stream-text.ts:7`                       | No outside caller. Un-export.                                                                                          |
| Barrel bypass: `../../libs/preferences/shared/themes.ts` | `atoms/theme.ts:8`, `app-providers.tsx:10`, `theme-effects.tsx:11` | Import from `#libs/preferences/shared`.                                                                                |
| `IconSelfh`                                              | `components/common/icon-selfh.tsx`                                 | Only widgets use it, so a library imports from `#app`. Move it to `libs/widgets/shared`.                               |
| `process.env.HANGAR_DB_HOST`                             | `jobs/server/middleware.ts:17`                                     | Read it through `env`, as `env.ts` asks.                                                                               |

---

## Deliberately left alone

- **A wrapper for the server actions** (`requireSession` + try/catch + log). The messages,
  context and `HangarError` handling all differ, so the wrapper would take as many arguments
  as it removes.
- **A shared `SettingsCard` shell.** Title, description, footer and width are about as many
  props as the lines it saves.
- **Navbar desktop vs mobile.** They already share `navigations`, and the tab bar is
  stateless.
- **The polling loops in the two SSE routes.** Their order is opposite (send then wait vs
  wait then send), and the shared part is about 6 lines.
- **`useDockerStats` vs the notifications `EventSource`.** Their lifecycles differ: one
  disconnects when the tab is hidden, the other keeps its feed position.
- **`runJob` / `cancelJob`, the two `--env-file` compose calls, and `allSettled` unwrapping.**
  Each has two copies, and a helper would need as many parameters as it removes.
- **`HangarError` setting `name = new.target.name`.** The bundle renames classes.
- **Shared `getSession` mocks across the API tests.** `vi.mock` is hoisted per file, so a
  shared helper fights vitest.

## Order of attack

1. **Dead code, the barrel bypasses, and the `server-only` alias.** Pure deletions, a few
   minutes each.
2. **§1, §2 and §5.** The biggest cuts, all confined to `components/`.
3. **§8 to §14.** Each is local to one or two files and independent of the others.
4. **§7.** Waits on the KiB vs KB decision.
