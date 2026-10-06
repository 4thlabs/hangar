# Development

## Setup

You need Node 24 and a Docker daemon reachable through its socket.

```bash
git clone https://github.com/4thlabs/hangar.git && cd hangar
npm ci
cp .env.example .env
npm run db:migrate
npm run dev
```

The app is served at <http://localhost:3010>. With the example `.env`, everything Hangar writes —
the store clone, the installed links, `.env.global` and the database — goes to `./.data`, which
is git-ignored.

## Scripts

| Script                            | What it does                                   |
| --------------------------------- | ---------------------------------------------- |
| `npm run dev`                     | Waku dev server on port 3010                   |
| `npm run build` / `npm start`     | Production build, and serving it               |
| `npm test`                        | Vitest, once                                   |
| `npm run typecheck`               | `tsc --noEmit`                                 |
| `npm run format` / `format:check` | Prettier                                       |
| `npm run typegen`                 | Regenerates Waku's typed routes                |
| `npm run db:generate`             | Generates a Drizzle migration from the schemas |
| `npm run db:migrate`              | Applies the migrations to `HANGAR_DB_HOST`     |
| `npm run db:studio`               | Opens Drizzle Studio on the database           |

CI runs `typecheck`, `test` and `build` on every pull request and push to `main`. A `v*` tag also
builds the image for `amd64` and `arm64` and publishes it to `ghcr.io/4thlabs/hangar`.

## Database

Hangar keeps its own state in SQLite, through Drizzle: the Better Auth tables
(`src/libs/db/schemas/auth-schema.ts`) and the notifications
(`src/libs/db/schemas/notification-schema.ts`). Sidequest stores its jobs in the same file.

To change the schema, edit those files, then run `npm run db:generate` and commit the folder it
adds under `src/drizzle/`. The container applies pending migrations on every start.

## Architecture

```
src/
├── app/        # what Waku needs: thin pages, middleware, API routes, styles
├── modules/    # one per page domain: apps, store, settings, auth, notifications, widgets, common
├── libs/       # framework-free libraries: hangar, docker, db, jobs, env, notifications, …
├── cli/        # the commander CLI
└── drizzle/    # generated migrations
```

- **`libs`** hold the logic as classes that take their dependencies through their constructor,
  so a test can pass an in-memory database instead of mocking a module. `HangarStore` owns the
  store clone, the links and the compose calls; `HangarConfig` reads `hangar.yml`; `HangarEnv`
  manages `.env.global`; `Docker` wraps the daemon and caches its answers, refreshed by its events.
  Slow reads go through the one `Cache` (`#libs/cache`, see [ADR 0001](adr/0001-cache.md)).
- **`modules`** hold each page's server actions, components and hooks. The pages in `src/app` only
  compose them.
- **Server-only code** is bound in each library's `server/` entry point, guarded with
  `import "server-only"`. The libraries themselves carry no guard, because three entry points run
  in plain Node: the CLI, the migration script and the Sidequest worker (`sidequest.jobs.js`).

The conventions — entry points, the `#libs/*` and `#*` import map, where code goes — are written
down in [`AGENTS.md`](../AGENTS.md). Read it before adding a library or a module.

## Adding a widget

1. Add the type to the `widgetConfigSchema` union in `src/modules/widgets/config/config.ts`. Its
   first segment must be the store app it reads (`foo-status` reads the `foo` app).
2. Create `src/modules/widgets/<app>/`: an `api/client.ts` built on `ServiceClient`, and a widget
   built with `defineWidget`, which provides the cache, the skeleton and the error card.
3. Register it in `src/modules/widgets/registry.ts`.
4. Document it in [`docs/widgets.md`](widgets.md).

The existing widgets each come with tests next to them, against a mocked service; follow one of
them.
