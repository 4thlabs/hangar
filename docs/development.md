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

CI runs `typecheck`, `test` and `build` on every pull request and push to `main`, its `rust` job checks
the Cargo workspace, and its `web` job builds and tests the Rust server's page (see the Rust section of
[`AGENTS.md`](../AGENTS.md)). Its `cli` job builds the static `hangar` binary for the host, and `image-cli`
the Dockerfile's `cli` stage, which puts it in the image. Each push to `main` (a merged pull request) and
each `v*` tag also builds the image for `amd64` and `arm64` and publishes it to `ghcr.io/4thlabs/hangar`:
as `edge` for `main`, as the release tags for a `v*` tag.

A release is cut with `gh release create vX.Y.Z --notes "…"`, which pushes the tag. The `v*` tag
then attaches the binaries of the `cli` job to its release, with their checksums
(`hangar-x86_64-unknown-linux-musl`, `hangar-aarch64-unknown-linux-musl`, and each one's `.sha256`).
A tag pushed alone, with `git push`, gets a release without notes, which `gh release edit vX.Y.Z
--notes "…"` fills in.

## The Rust server

The server rewritten in Rust (see the Rust section of [`AGENTS.md`](../AGENTS.md)) runs beside the Waku version, on
the same data directory and the same `.env`. Its page is in `web/`. You need Rust, and `cargo quoll`, at the tag of
the quoll the contract uses:

```bash
cargo install --git https://github.com/4thlabs/quoll --tag v0.10.0 quoll-cli --locked
npm ci --prefix web
cargo quoll dev
```

`cargo quoll dev` writes the OpenAPI document and orval's hooks, starts the server on port 3010, then Vite, which
serves the page at <http://localhost:5173> and proxies `/api` to the server. A change to a crate rebuilds and
restarts the server, a change to the contract writes the hooks again.

`cargo quoll build` builds the page in `web/dist`, which the server serves when `HANGAR_PAGE_DIR` names it:
`HANGAR_PAGE_DIR=web/dist cargo run -p hangar-server`, at <http://localhost:3010>.

The server reads its settings from the environment, then from the `.env` of the directory it runs in, as the
`hangar` binary does; an empty variable is not set. A value missing or bad stops it at the start, with every variable
at fault named.

| Variable                                                | What it is                                              |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `HANGAR_DATA_DIR`                                       | The data directory, required                            |
| `HANGAR_STORE_URL`                                      | The git URL of the store, required                      |
| `DOMAIN`                                                | The domain the apps are served under, required          |
| `GITHUB_TOKEN`, `FINNHUB_API_KEY`                       | The keys of the widgets that call those services        |
| `HANGAR_SSH_HOST`, `HANGAR_SSH_USER`, `HANGAR_SSH_PORT` | The host the terminal signs in to; a port 1–65535       |
| `HANGAR_PAGE_DIR`                                       | The page to serve beside the API, with its `index.html` |

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
├── modules/    # one per page domain: apps, store, terminal, settings, auth, notifications, widgets, common
├── libs/       # framework-free libraries: hangar, docker, ssh, terminals, db, jobs, backups, env, …
├── cli/        # the commander CLI
└── drizzle/    # generated migrations
```

- **`libs`** hold the logic as classes that take their dependencies through their constructor,
  so a test can pass an in-memory database instead of mocking a module. `HangarStore` owns the
  store clone, the links and the compose calls; `HangarConfig` reads `hangar.yml`; `HangarEnv`
  manages `.env.global`; `Docker` wraps the daemon and caches its answers, refreshed by its events;
  `AppBackups` zips an app's data folder, which the `BackupApp` job runs on the schedules
  `BackupJobs` keeps in step with `hangar.yml`. `TerminalSessions` keeps the open terminals, whose
  shells `ContainerShells` starts in a container and `HostShells` on the host, over SSH, signing in
  from the terminal itself (`SshSignIn`, `SshTerminal`).
  Slow reads go through the one `Cache` (`#libs/cache`, see [ADR 0001](adr/0001-cache.md)).
- **`modules`** hold each page's server actions, components and hooks. The pages in `src/app` only
  compose them.
- **Server-only code** is bound in each library's `server/` entry point, guarded with
  `import "server-only"`. The libraries themselves carry no guard, because three entry points run
  in plain Node: the CLI, the migration script and the Sidequest worker (`sidequest.jobs.js`).

The conventions — entry points, the `#libs/*` and `#*` import map, where code goes — are written
down in [`AGENTS.md`](../AGENTS.md). Read it before adding a library or a module.

## Adding a widget

1. Create `src/modules/widgets/<app>/`: an `api/client.ts` built on `ServiceClient`, and a `.tsx`
   exporting the widget's body (`load` and `render`), which `defineWidget` wraps in the cache, the
   skeleton and the error card.
2. Describe it in `<app>/descriptor.ts` with `describeWidget`: its schema
   (`WidgetSchema.service("foo-status")` for a widget that reads a store app), the `app` it reads,
   its title, its icon from [Dashboard Icons](https://dashboardicons.com) (`WidgetIcon.dashboard`)
   and how to build it from its lazily imported module. No JSX there: the CLI loads the descriptors.
3. List the descriptor in `src/modules/widgets/config/widgets.ts`.
4. Document it in [`docs/widgets.md`](widgets.md).

The existing widgets each come with tests next to them, against a mocked service; follow one of
them.
