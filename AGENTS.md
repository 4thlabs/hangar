# Conventions

## Libraries under `src/libs`

- One entry point = one `index.ts`, which only re-exports. Implementation goes in named files
  beside it (`format/index.ts` → `format/relative-time.ts`, `docker/server/index.ts` →
  `server.ts`).
- Inside a library, import relatively. From outside, only through a barrel: `#libs/docker`, never
  `#libs/docker/compose.ts`. Needing a file directly means the library is missing an entry point.
- Nested entry points are free — `#libs/db/server`, `#libs/widgets/config`, `#libs/docker/mock`
  need no configuration. Test doubles get one, so a mock never sits in the public barrel.

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
(`sidequest.jobs.js`, outside the bundle). A job builds its own dependencies, as
`check-image-version.ts` does. Keep `#libs/hangar` and `#libs/widgets/config` free of JSX.

## Classes

A library's unit of work is a class taking its dependencies as constructor arguments — that is
what lets a test pass an in-memory database instead of mocking a module.

## Responsive layouts

One tree, never one per breakpoint: a subtree hidden with `md:hidden` is still mounted, and every
control in it runs twice with its own state, effects and subscriptions. Use one grid with explicit
`col-start-*` (an element hidden below `md` is not a grid item, so the rest shifts) and carry the
differences as classes on a single element.
