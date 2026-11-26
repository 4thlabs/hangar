# Conventions

## Libraries under `src/libs`

- One entry point = one `index.ts`, which only re-exports. Implementation goes in named files
  beside it (`format/index.ts` → `format/relative-time.ts`, `docker/server/index.ts` →
  `server.ts`).
- Inside a library, import relatively. From outside, only through a barrel: `#libs/docker`, never
  `#libs/docker/compose.ts`. Needing a file directly means the library is missing an entry point.
- Nested entry points are free — `#libs/db/server`, `#libs/hangar/server`, `#libs/docker/mock`
  need no configuration. Test doubles get one, so a mock never sits in the public barrel.

## Modules under `src/modules`

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

## Import mapping

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

A library's unit of work is a class taking its dependencies as constructor arguments — that is
what lets a test pass an in-memory database instead of mocking a module.

Helpers and constants are static members of a class, in libraries and modules alike: no free
function or module-level `const`. The exceptions are React components and hooks, Waku page exports
(`getConfig`), `"use server"` action exports, test fixtures under `mock/`, and the commander
definitions in `src/cli`.

## Translations

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

Write code for the next human reader. Clarity beats cleverness and brevity.

- Follow the project first: match existing conventions, naming, structure and tooling; run the formatter and linter before finishing.
- Names: say what and why (`elapsedDays`, `isEligibleForRefund`). No `data`, `tmp`, `util`, `manager`, invented abbreviations, or misleading names. One word per concept.
  On a class member, the class carries the context and the method the action: `ActionToast.create`, not
  `ActionToast.of`.
- Functions: small, one job, one level of abstraction; ≤ 3–4 parameters; no boolean flags that switch behavior.
- Control flow: early returns, nesting ≤ 3, complex conditions extracted into named variables. No nested ternaries or clever one-liners. Every `if`, `else` and loop body is a braced block on its own lines, even a lone `return`.
- Blank lines: one after a multi-line statement, after a group of declarations, and before a `return` that is not alone in its block. `npm run lint:fix` applies them; Prettier sorts the imports.
- Structure: put code where a newcomer would look for it; no god files or growing `utils`; dependencies flow one way.
- Duplication: one place per rule or constant, but no premature abstraction; a little repetition beats a helper full of options.
- Comments: explain why, never what. No commented-out code, no stale comments, no TODO without context. Document public APIs.
- Data: explicit types and shapes; named constants instead of magic numbers/strings; avoid `any`.
- Errors: never swallow them; add context; keep the happy path readable.
- Tests: names describe behavior; setup visible in the test.
- Scope: change only what the task needs; keep refactors separate from behavior changes.

## Rust

The server is being rewritten in Rust, in the Cargo workspace at the root, beside the Waku version, which stays the
published image until the switch. The sections above are the TypeScript conventions, for `src/`. The Rust code
follows [`docs/rust/CODING_RULES.md`](docs/rust/CODING_RULES.md): read it before writing or reviewing Rust.

```
Cargo.toml        # the workspace: members = ["crates/*"], the shared settings and lints, `cargo quoll`'s config
crates/
├── core/         # hangar-core, the library: no web framework, quoll's client alone
├── cli/          # hangar-cli, the binary `hangar`, on the core
├── api/          # hangar-api, the server's contract in quoll: one `quoll::group!` per area, its OpenAPI document
└── server/       # hangar-server, the binary `hangar-server`, on the core and the contract
web/              # the server's page: a Vite SPA on the TanStack Query hooks orval writes from the document
```

`web/` is a package of its own, beside Waku's: the switch removes the root's without touching it. It follows the
TypeScript conventions above, with the same import mapping and the root's Prettier and eslint (`npm run lint` covers
`web/src`), and takes from `src/` what a page it moves needs, copied: the Waku version keeps its own until the switch.
Its `src/libs/api/generated.ts` and `web/openapi.json` are written by `cargo quoll gen`, never committed.

The page is English only, decided with the maintainer on 2026-11-24: the Translations section above is the Waku
version's alone, until the switch. `web/` has no catalog, no translation helper, no language cookie or switch; its
text is written in English in its components, and `Intl` formats dates and numbers in English. A page moved from
`src/` leaves its `messages.ts` behind and takes the English words.

### Errors the page shows

The page stays English only, but must take a translation later without the server being reworked. So the server never
builds text for the user alone: what it says to the page is a code and its params, beside their English words.

- **Server.** Every error the page may show is a variant of `hangar_api::ErrorCode`: a stable code
  (`store.unknown_app`), its params (`{ app }`), its status and its English message, written in one place,
  `ErrorCode::message`. A handler returns `ErrorCode::UnknownApp { .. }.into()`, or `Failure::logged(code, &error)` for
  a failure of its own, which logs the cause whole and sends only the code's words. No `Error::new(status, format!(..))`
  of words of its own, and never a command's output, where a URL's credentials or an environment value may be. A
  notification is already a key and its params, rendered where it is read. Logs, and the messages the core's errors
  carry, stay English text.
- **Wire.** quoll writes a problem's status and detail alone: the code and its params go on the wire with
  [quoll#140](https://github.com/4thlabs/quoll/issues/140). Until then the detail is the code's English message, and
  nothing else carries the code: no code in the detail, no header of Hangar's own, no body written by hand.
- **Web.** The page says why a call failed through `ErrorMessage.of(error)` (`web/src/modules/common/error-message.ts`),
  the one place that will key the words by the code for a catalog; until quoll#140 it shows the detail. The page's
  own words stay in its components, in English.
- The errors of signing in (#170) get their codes with the move to quoll#140.

What CI's `rust` job runs, warnings as errors:

```bash
export RUSTFLAGS="-D warnings" RUSTDOCFLAGS="-D warnings"
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-features --locked
cargo doc --workspace --all-features --no-deps --locked
```

What CI's `web` job runs, with [`cargo quoll`](https://github.com/4thlabs/quoll/blob/v0.10.0/docs/guides/typescript.md)
installed at the tag of the quoll the contract uses:

```bash
npm ci --prefix web
cargo quoll build      # the document, orval's TypeScript, then tsc and vite build in web/
npm test --prefix web
```

A change to the contract rewrites its snapshot: `SNAPSHOT=overwrite cargo test -p hangar-api --test openapi`, and
the diff is reviewed.

`cargo run -p hangar-cli -- <args>` runs the binary, and `HOST=127.0.0.1 PORT=3011 cargo quoll dev` the server,
orval and Vite, beside the Waku version's `npm run dev`. The Docker image builds the binary in its `cli` stage, on
Alpine, and ships it at `/usr/local/bin/hangar`; nothing else of the workspace goes into the image. CI's `cli` job
builds it static for the host, x86_64 and aarch64 musl, and a `v*` tag attaches it to its release. A build given
`HANGAR_VERSION`, the tag, prints it for `--version`, its `v` left out; any other prints the workspace's version with
`-dev`.
