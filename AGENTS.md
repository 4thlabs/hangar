# Conventions

The TypeScript has two homes until the switch, #181. `src/` is the Waku version: the sections below marked "`src/`
only" are its conventions, and #181 removes them with it. `web/`, the Rust server's page, follows
[`docs/web/CODING_RULES.md`](docs/web/CODING_RULES.md) and [ADR 0002](docs/adr/0002-web-design.md): read them before
writing or reviewing its code. Both follow the import mapping, "Responsive layouts", and the readability rules of the
coding rules.

## Libraries under `src/libs`

`src/` only, until #181.

- One entry point = one `index.ts`, which only re-exports. Implementation goes in named files
  beside it (`format/index.ts` → `format/relative-time.ts`, `docker/server/index.ts` →
  `server.ts`).
- Inside a library, import relatively. From outside, only through a barrel: `#libs/docker`, never
  `#libs/docker/compose.ts`. Needing a file directly means the library is missing an entry point.
- Nested entry points are free — `#libs/db/server`, `#libs/hangar/server`, `#libs/docker/mock`
  need no configuration. Test doubles get one, so a mock never sits in the public barrel.

## Modules under `src/modules`

`src/` only, until #181. `web/`'s are [below](#the-page-in-websrc).

- One module per page domain (`apps`, `store`, `settings`, `auth`, `notifications`, `widgets`
  for the dashboard), holding its `actions/`, `components/`, `hooks/` and plain `.ts` helpers at
  its root. Shared code and the app shell (shadcn `ui/`, navbar, providers, theme atoms) live in
  `common`. `spotlight` is the search palette: its engine and the list of its sources; each source
  sits in the module of its domain (`apps/spotlight-source.ts`).
- An action belongs to the module whose page calls it. A module may import another directly.
- Import deeply through `#modules/…` (the existing `#*` rule), with the extension. No barrel: one
  re-exporting both `"use server"` and `"use client"` files drags server code into client bundles.
- `src/app` keeps only what Waku needs (`srcDir`): `pages/` as thin shells, `middleware/`, `api/`,
  styles.

## The page in `web/src`

ADR 0002's decisions 1 and 6, as #207 and #210 amended them: TanStack Router's own layout, modules kept apart, and
the routes in one folder per section.

```
main.tsx, page.ts, router.ts   the wiring: createPage, the router, the providers; no app/ folder
routes/                        one file per route = its page; _app/route.tsx is the shell, its pieces in _app/-shell/;
                               one folder per section under _app/; a page's tests beside it (apps/index.test.tsx)
modules/<d>/
  components/                  the pieces the pages are made of
  hooks/
  api/                         query and mutation options, keys, invalidation, services such as Session
  helpers/                     plain functions and consts, no React: search params, filters, formats, labels
  messages.ts                  the module's words, the one file at a module's root
modules/common/                what two modules or more share: ui/, components/, hooks/, api/, helpers/
libs/                          the API client, formats, preferences
```

The routes, as the maintainer decided on 2026-11-27 (#210):

```
routes/
  __root.tsx
  login.tsx                         /login, no shell and no guard
  _app/
    route.tsx                       the layout: the session guard and the shell
    -shell/                         the shell's pieces
    index.tsx  index.test.tsx       /
    apps/
      index.tsx  index.test.tsx     /apps
      $project.tsx                  /apps/:project
    store/
      index.tsx  index.test.tsx     /store
      new.tsx                       /store/new
      $id.edit.tsx  $id.edit.test.tsx   /store/:id/edit
    settings/
      index.tsx  index.test.tsx     /settings
    cluster/
      index.tsx                     /cluster
    $.tsx                           not-found, in the frame
    -not-found-page.tsx  -pending-page.tsx
```

A folder per section, always, even for a section with one page, and no layout route inside a section: its pages are
siblings, so no file name needs a `_` escape. `store/$id.edit.tsx` keeps its dot. The layout is `_app/route.tsx`, with
everything it uses in `_app/`. A page's tests sit beside it. An index page's route id ends with `/`
(`useSearch({ from: "/_app/apps/" })`); links still go `to="/apps"`.

A card or a widget reads with `useQuery`, in the component that renders it, and shows the result through
`QueryRegion`, or `RenderRegion` when it reads nothing: ADR 0002's decision 4, as #203 amended it on the maintainer's
decision of 2026-11-27. No suspense read in a card.

A module imports only `common`, `#libs/...` and its own files, and `common` no other module: the routes compose the
modules. ESLint holds it, with `#modules/...` imports and no `..` segment, along with rule 4 on `helpers/` and
`messages.ts` (no React, no TanStack, only types from `api/`, `hooks/`, `components/`, `ui/`) and no other file directly
under a module than `messages.ts` and its test.

## Import mapping

For `src/` and `web/`, which has the same.

```json
"imports": {
  "#libs/*": "./src/libs/*/index.ts",
  "#*": "./src/*"
}
```

Two rules, and they are not meant to grow: when a specifier does not resolve, add the missing
`index.ts`, never a per-library line. `tsconfig.json` mirrors them.

Do not retry these, all verified here:

- `**` is not a glob — the capture is substituted into every `*` (`#libs/env` →
  `src/libs/envenv/index.ts`).
- `"./src/libs/*"` — ESM does no directory-to-`index.ts` lookup; vite accepts it, plain Node does
  not.
- A fallback array recovers from an invalid target, not a missing file.
- A suffix after the star (`"#libs/*.ts"`) works in Node but not in vite, which builds the regex
  without escaping the dot: `#libs/widgets` silently resolves to `src/libs/widg.ts`.

## `server-only`

`src/` only, until #181.

A library carries no guard: it takes its dependencies by injection, and the guard sits in the
composition root that binds them — `notifications/notifications.ts` (class) vs
`notifications/server/server.ts` (`import "server-only"` + the instance). Same split as
`hangar`, `docker`, `db`.

Required, because three entry points are plain Node, where `server-only` throws and `.tsx` cannot
load at all: `bin/cli.js`, `node src/libs/db/utils/migrate.ts`, and the Sidequest worker
(`sidequest.jobs.js`, outside the bundle). A job gets its dependencies from the worker's own
composition root, `src/libs/jobs/worker.ts`. Keep `#libs/hangar` free of JSX, and with it
`src/modules/widgets/config/widgets.ts` and the `descriptor.ts` files it lists, which it imports: a
descriptor reaches its components only through `import()`.

## Classes

`web/` has no class made only of static members (ADR 0002, decision 7), which ESLint's `no-restricted-syntax` holds:

- **What has no state is module functions and consts**, imported by name. A function's name carries its context.

  ```ts
  // modules/settings/helpers/job-text.ts
  export const jobsPollMs = 1000;

  export function askedAgainText(asked: JobRun): string {
    const job = jobName(asked.job);

    return asked.state === "running" ? settingsMessages.jobs.runs({ job }) : settingsMessages.jobs.waits({ job });
  }
  ```

- **What has state or dependencies is a class created with `new`**, its dependencies as constructor arguments. Its one
  instance is created in `createPage` (`web/src/page.ts`), and a test builds its own with `new`, with no module
  mock.

  ```ts
  // modules/auth/api/session.ts
  export class Session {
    readonly #queryClient: QueryClient;

    constructor(queryClient: QueryClient) {
      this.#queryClient = queryClient;
    }

    async require(): Promise<SessionUser> {
      /* ensureQueryData, or a redirect to /login */
    }
  }
  ```

- **A helper of one hook that needs the hook's values is a closure of that hook**, not a class. One that several of
  its effects call is a module function beside it, taking what it needs, as `changeNotifications(queryClient, change)`:
  as a closure it would be a dependency of each effect, which `exhaustive-deps` asks to wrap in a `useCallback`.

  ```ts
  export function useDockerChanges() {
    const queryClient = useQueryClient();
    const invalidate = (queryKey: QueryKey) => void queryClient.invalidateQueries({ queryKey });

    const { isDown } = useEventFeed<DockerChange>(getDockerChangesUrl(), {
      onOpen: () => invalidate(allDockerQueries),
      onItem: change => staleAfterDockerChange[change].forEach(invalidate),
    });
    // ...
  }
  ```

- `static` stays only for a real factory or constant of a class that has instances, as `Preferences.fromCookies` or
  `WidgetIcon.dashboard`. `ApiError extends Error` and the test doubles with instances are classes as before.

`src/` keeps its own rule, until #181:

A library's unit of work is a class taking its dependencies as constructor arguments — that is
what lets a test pass an in-memory database instead of mocking a module.

Helpers and constants are static members of a class, in libraries and modules alike: no free
function or module-level `const`. The exceptions are React components and hooks, Waku page exports
(`getConfig`), `"use server"` action exports, test fixtures under `mock/`, and the commander
definitions in `src/cli`.

## Translations

`src/` only, until #181. `web/` is English only: see the Rust section.

- Every word the UI shows sits in a catalog, a module's `messages.ts`:
  `class AppsMessages { static readonly en = {…}; static readonly fr: typeof AppsMessages.en = {…} }`. English
  gives the shape, so a key missing in French is a type error. A message that interpolates is a function of one
  object, `remove: ({ key }: { key: string }) => …`, and one that counts picks its form with `Plural.select`.
- Read it with `t`, a dotted path checked by `tsc`. In a client component, `useTranslation(Catalog)`; in a server
  component, an action or an API route, `ServerTranslation.get(Catalog)`; anywhere else,
  `Translation.create(Catalog, locale)`. Each also hands back `locale`, for numbers and dates through `IntlFormats`.
- What outlives the request is filed in no language: a notification stores a key and its parameters
  (`Notifications.message`) and is rendered where the reader is known (`NotificationText.render`).
- Logs, the messages libraries throw, and the CLI stay in English. A library that speaks to the user takes its words
  from the caller, which reads them from a catalog: `HostShells.open(size, TerminalMessages[locale].shell)`.

## Responsive layouts

One tree, never one per breakpoint: a subtree hidden with `md:hidden` is still mounted, and every
control in it runs twice with its own state, effects and subscriptions. Use one grid with explicit
`col-start-*` (an element hidden below `md` is not a grid item, so the rest shifts) and carry the
differences as classes on a single element.

## Code readability

The readability rules are in [`docs/web/CODING_RULES.md`](docs/web/CODING_RULES.md#readability), for `src/` too
until #181.

## Rust

The server is being rewritten in Rust, in the Cargo workspace at the root, beside the Waku version, which stays the
published image until the switch. The TypeScript conventions are above and in `docs/web/CODING_RULES.md`. The
Rust code follows [`docs/rust/CODING_RULES.md`](docs/rust/CODING_RULES.md): read it before writing or reviewing Rust.

```
Cargo.toml        # the workspace: members = ["crates/*"], the shared settings and lints, `cargo quoll`'s config
crates/
├── core/         # hangar-core, the library: no web framework, quoll's client alone
├── cli/          # hangar-cli, the binary `hangar`, on the core
├── api/          # hangar-api, the server's contract in quoll: one `quoll::group!` per area, its OpenAPI document
└── server/       # hangar-server, the binary `hangar-server`, on the core and the contract
web/              # the server's page: a Vite SPA on the TanStack Query hooks orval writes from the document
```

`web/` is a package of its own, beside Waku's: the switch removes the root's without touching it. It follows
[`docs/web/CODING_RULES.md`](docs/web/CODING_RULES.md), with the same import mapping, the root's Prettier and ESLint
(`npm run lint` covers `web/src`), and its own oxlint for the rules that read types (`npm run lint --prefix web`). It
takes from `src/` what a page it moves needs, copied: the Waku version keeps its own until the switch. Its
`src/libs/api/generated.ts`, its MSW handlers `generated.msw.ts`, and `web/openapi.json` are written by
`cargo quoll gen`, never committed. Its `src/routeTree.gen.ts` is not committed either: TanStack Router writes it from
the route files of `src/routes/`, by its Vite plugin in `vite` and the tests, and by `tsr generate` at the start of
the `build`, `typecheck` and `lint` scripts, which run `tsc` and oxlint before Vite. Its design is
[ADR 0002](docs/adr/0002-web-design.md), accepted on 2026-11-26, and the `hangar-web` skill gives its rules in short.
Where the ADR and the sections for `src/` differ, `web/` follows the ADR: no class made only of statics, and its words
in a plain `messages.ts` per module.

The page is English only, decided with the maintainer on 2026-11-24: the Translations section above is the Waku
version's alone, until the switch. `web/` has no translation helper, no `t()`, no language cookie or switch. Its words
are written in English, in each module's `messages.ts`, a plain object (ADR 0002, decision 5, which partly reverses
the 2026-11-24 line "in its components"), and `Intl` formats dates and numbers in English. A page's words are in its
section's module, the shell's in `common/messages.ts` (#204). A page moved from `src/` takes the English words of its
`messages.ts`, without the French.

The Rust server runs its jobs in its own process, in memory (`crates/server/src/jobs.rs`): a scheduler, its crons
read by the core's `CronSchedule`, and queues of one job at a time. The Sidequest worker and its composition root,
above, are the Waku version's alone until the switch; a job of the Rust server takes what it works with from `App`,
as a route does.

### Errors the page shows

The page stays English only, but must take a translation later without the server being reworked. So the server never
builds text for the user alone: what it says to the page is a code and its params, beside their English words.

- **Server.** Every error the page may show is a variant of `hangar_api::ErrorCode`: a stable code
  (`store.unknown_app`), its params (`{ app }`), its status and its English message, written in one place,
  `ErrorCode::message`. A handler returns `ErrorCode::UnknownApp { .. }.into()`, or `Failure::logged(code, &error)` for
  a failure of its own, which logs the cause whole and sends only the code's words. No `Error::new(status, format!(..))`
  of words of its own, and never a command's output, where a URL's credentials or an environment value may be. The
  one exception is Docker's complaint about a compose file the editor saves (`editor.compose_rejected`): it is about
  the operator's own file, and the only way to say what to fix in it, so it goes as a param, the app's files named by
  their paths in its folder, a URL's credentials taken out, and the values of `.env.global` and of the server's
  environment too, which an interpolation error echoes. A notification is already a key and its params, rendered
  where it is read. Logs, and the messages the core's errors carry, stay English text.
- **Wire.** A problem carries the code as its `type`, `/problems/<code>` relative to the server
  (`/problems/store.unknown_app`), its params as extension members (`"app": "alpha"`), and the code's English message
  as its detail, all written by `From<ErrorCode> for quoll::Error`; a param is named as RFC 9457 names a member, three
  characters at least and none of its own. A wait goes in its header, `Retry-After` on a 429, never in the words. A
  body that holds an error, as a store sync's, carries it whole, a `hangar_api::ErrorDetail`:
  `{ code, params, message }`. `ErrorCode::read(&error)` gives a client of the contract back the code of a problem.
  No code in the detail, no header of Hangar's own, no body written by hand.
- **Web.** `ApiError.detail` reads a problem's code and params into the `ErrorDetail` a body carries. The page says
  why a call failed through `describeError(error)`, and words an `ErrorDetail` through
  `describeErrorDetail(detail)` (`web/src/modules/common/helpers/error-message.ts`): the one place that keys the words
  by the code, typed by the codes of the contract, so that a code without words is a type error, and that a catalog
  will word in another language. A code the page does not know, from a server newer than it, shows the server's
  message; a problem of no code, one quoll answers itself, its detail. The page's own words stay in its components,
  in English.

What CI's `rust` job runs, warnings as errors:

```bash
export RUSTFLAGS="-D warnings" RUSTDOCFLAGS="-D warnings"
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-features --locked
cargo doc --workspace --all-features --no-deps --locked
```

What CI's `web` job runs, with [`cargo quoll`](https://github.com/4thlabs/quoll/blob/v0.11.0/docs/guides/typescript.md)
installed at the tag of the quoll the contract uses:

```bash
npm ci --prefix web
cargo quoll build      # the document, orval's TypeScript, then tsc and vite build in web/
npm run lint --prefix web   # oxlint's type-aware rules, on orval's TypeScript
npm test --prefix web
```

The root's `ci` job runs `npm run lint`, ESLint on `src/` and `web/src`, warnings as errors.

A change to the contract rewrites its snapshot: `SNAPSHOT=overwrite cargo test -p hangar-api --test openapi`, and
the diff is reviewed.

`cargo run -p hangar-cli -- <args>` runs the binary, and `cargo quoll dev` the server, orval and Vite, beside the
Waku version's `npm run dev`. The Docker image builds the binary in its `cli` stage, on Alpine, and ships it at
`/usr/local/bin/hangar`; nothing else of the workspace goes into the image. CI's `cli` job builds it static for the
host, x86_64 and aarch64 musl, and a `v*` tag attaches it to its release. A build given `HANGAR_VERSION`, the tag,
prints it for `--version`, its `v` left out; any other prints the workspace's version with `-dev`.

## Skills

The agents' skills are in `.claude/skills/`, a link to `.agents/skills/`, so that every worktree has them. For
`web/`, load them before writing or reviewing its code:

- **`hangar-web`**, this project's: ADR 0002's rules in short, with one example per layer. It comes first.
- **`react-query`**: TkDodo's guides to TanStack Query, vendored from `umxr/react-query-skills`.
- **`vercel-react-best-practices`** and **`vercel-composition-patterns`**: React's performance rules and its
  composition patterns, vendored from `vercel-labs/agent-skills`.
- **TanStack Router's own skills**, which ship in its npm packages and are read with TanStack Intent, a dev dependency
  of `web/` pinned to an exact version. `intent.skills` in `web/package.json` lists the packages it shows. From
  `web/`, after `npm ci`:

  ```bash
  npm exec --no -- intent list
  npm exec --no -- intent load @tanstack/router-core#router-core/data-loading
  ```

  TanStack Query 5.108 ships none: its skill is `react-query`.

Each vendored folder is the upstream folder byte for byte, at the commit its `SOURCE.md` gives, with its license. To
update one, copy the folder again from a newer commit and change its `SOURCE.md`; never edit it in place. The
coding-team plugin's `lang-typescript` stays the language's skill, and nothing of it is copied here.

What of the third-party skills does not apply here:

- **React's compiler is on.** The rules of manual memoization are not followed: `rerender-memo`,
  `rerender-memo-with-default-value`, `rerender-simple-expression-in-memo`, and any advice to add `useMemo`,
  `useCallback` or `memo`. The compiler memoizes, and a hand-written one only adds noise.
- **The page is an SPA, with no RSC and no SSR.** The `server-*` rules, `async-api-routes`, the `rendering-hydration-*`
  rules, and everything about Next.js, Remix or server components do not apply. `client-swr-dedup` does not either:
  the page's cache is TanStack Query.
- **Where a third-party skill and ADR 0002 disagree, the ADR wins.** For example: no global toast on every failure,
  against `error-global-callbacks`; a form submits with `mutateAsync` inside TanStack Form's `onSubmit`, against
  `mutation-prefer-mutate`; optimistic updates only by the ADR's rule (decision 12), narrower than
  `mutation-optimistic-when`.
