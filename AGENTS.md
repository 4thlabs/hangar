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
  `common`.
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

## Responsive layouts

One tree, never one per breakpoint: a subtree hidden with `md:hidden` is still mounted, and every
control in it runs twice with its own state, effects and subscriptions. Use one grid with explicit
`col-start-*` (an element hidden below `md` is not a grid item, so the rest shifts) and carry the
differences as classes on a single element.

## Code readability

Write code for the next human reader. Clarity beats cleverness and brevity.

- Follow the project first: match existing conventions, naming, structure and tooling; run the formatter and linter before finishing.
- Names: say what and why (`elapsedDays`, `isEligibleForRefund`). No `data`, `tmp`, `util`, `manager`, invented abbreviations, or misleading names. One word per concept.
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
