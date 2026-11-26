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
the same data directory and the same `.env`. Its page is in `web/`, in English only. You need Rust, and
`cargo quoll`, at the tag of the quoll the contract uses:

```bash
cargo install --git https://github.com/4thlabs/quoll --tag v0.11.0 quoll-cli --locked
npm ci --prefix web
cargo quoll dev
```

`cargo quoll dev` writes the OpenAPI document and orval's hooks, starts the server, then Vite, which serves the page
at <http://localhost:5173> and proxies `/api` to the server. A change to a crate rebuilds and restarts the server, a
change to the contract writes the hooks again. The server listens on 127.0.0.1:3011, the `HOST` and `PORT` that the
`env` of `[[workspace.metadata.quoll.server]]` gives it, beside its `url` and the proxy's target, so that it runs
beside `npm run dev` on 3010.

`cargo quoll build` builds the page in `web/dist`, which the server serves when `HANGAR_PAGE_DIR` names it:
`HANGAR_PAGE_DIR=web/dist cargo run -p hangar-server`, at <http://localhost:3010>.

The server reads its settings from the environment, then from the `.env` of the directory it runs in, as the
`hangar` binary does; an empty variable is not set. A value missing or bad stops it at the start, with every variable
at fault named.

| Variable                                                | What it is                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| `HOST`, `PORT`                                          | Where it listens, an IP and a port; `0.0.0.0:3010` unset     |
| `HANGAR_DATA_DIR`                                       | The data directory, required                                 |
| `HANGAR_STORE_URL`                                      | The git URL of the store, required                           |
| `DOMAIN`                                                | The domain the apps are served under, required               |
| `GITHUB_TOKEN`, `FINNHUB_API_KEY`                       | The keys of the widgets that call those services             |
| `HANGAR_SSH_HOST`, `HANGAR_SSH_USER`, `HANGAR_SSH_PORT` | The host the terminal signs in to; a port 1–65535            |
| `HANGAR_PAGE_DIR`                                       | The page to serve beside the API, with its `index.html`      |
| `HANGAR_URL`                                            | The origin the page is reached at, no path, required         |
| `HANGAR_SECRET`                                         | What the cookies are signed with, 32 bytes or more, required |
| `HANGAR_OIDC_ISSUER`, `HANGAR_OIDC_CLIENT_ID`           | The identity provider, set together                          |
| `HANGAR_OIDC_CLIENT_SECRET`                             | The client's secret, unset for a public client               |
| `HANGAR_OIDC_REDIRECT_URL`                              | The callback; `<HANGAR_URL>/api/auth/oidc/callback` unset    |

### Signing in

The users of `hangar.yml` sign in (see [the store](store.md#users)), by password or through an OpenID Connect
provider, and every route but those of `/api/auth` and `/api/health` answers 401 without a session. The session is
a cookie the server signs with a key derived from `HANGAR_SECRET`, `openssl rand -base64 32` prints one: it holds the
user's email, when they signed in, its expiry, and a value of their credentials, and nothing is kept on the server. A
session lasts seven days, and is renewed once a day old while the page is open, as Better Auth's are in the Waku
version, but never past thirty days from the sign-in. Signing out clears the cookie; a user removed from
`hangar.yml`, or whose `passwordHash` or `oidcSubject` changed, is signed out at their next request; changing
`HANGAR_SECRET` signs everyone out.

The cookies are `HttpOnly` and `SameSite=Lax`. When `HANGAR_URL` is `https`, they are `Secure` too, with the prefix
`__Host-` (`__Host-hangar-session`), which a page of a subdomain, as the apps Hangar serves, cannot set. Over plain
HTTP, a LAN address or `http://localhost` under `cargo quoll dev`, a browser keeps neither, Safari on `localhost`
included: they are `hangar-session` and `hangar-oidc`, neither `Secure` nor `__Host-`, and anyone on the network
can read them. **Plain HTTP is for a trusted network only**: anywhere else, serve Hangar over HTTPS. A `POST` or any
other request that changes something is refused with a 403 from another origin than `HANGAR_URL`'s, as Better Auth
refuses one from `BETTER_AUTH_URL`'s. Under `cargo quoll dev`, the page's origin is Vite's:

```bash
HANGAR_URL=http://localhost:5173
```

`HANGAR_URL` is an origin, `https://hangar.example.com`, with no path: the page is served at the root of its host.

Ten sign-ins by password for one email in fifteen minutes that did not succeed refuse that email with a 429 until the
oldest is fifteen minutes old, which its `Retry-After` says in seconds, and the page in minutes. An attempt is counted
as it starts, so that requests sent at once cannot get past the limit, and forgotten with the others of its email once
one succeeds. The limit is per email: behind the reverse proxy every request comes from its address. The users
`hangar.yml` lists are counted apart from the emails it does not, which are bounded: guesses on unknown emails never
refuse a user. The routes of `/api/auth` read a body of 16 KiB at most.

For the identity provider, register a confidential client whose redirect URL is the callback,
`<HANGAR_URL>/api/auth/oidc/callback`, and give the server its issuer, as the provider writes it in its discovery
document, its client id and its secret. The sign-in asks for the scopes `openid`, `email` and `profile`, with PKCE,
and checks the ID token against the provider's keys. The provider's discovery document and keys are kept five minutes,
one discovery at a time and 10 s at most, and discovered anew when they refuse an ID token's signature, as after the
provider rotated its keys, unless they are less than 30 s old. Under `cargo quoll dev`, the callback goes through Vite
too: `http://localhost:5173/api/auth/oidc/callback`.

### The store

The store's routes run on the core's `Store`, as the Waku version's actions do on `HangarStore`. **Store → Install**
links an app into `app-installed/` and seeds the variables its files reference; **Uninstall** runs `docker compose down`
first, and removes the link once compose has taken the app down: an app compose does not take down stays installed, so
that compose still reaches its files. Its folder in the store and its volumes are kept. An app installed that the store
no longer reads, its folder gone or its `compose.yml` or `hangar.yml` broken, goes by its link: compose takes down what
it can read of it, and the link is removed all the same. `/store` filters by installed or not on the server, which
counts both, and narrows by the name the navbar's search field puts in `?q=`; an invalid `hangar.yml` is shown there
with its field at fault.

**Store → New app** opens the template of a `compose.yml`, and saves it under the id typed in once `docker compose
config` accepts it: a file refused creates nothing, not even the app's folder. Each card's pencil opens the app's
editor, `/store/<app>/edit`, on its `compose.yml`: its files in a tree, 5 folders deep and 500 files at most, with no
hidden file, symlink, binary, or file over 1 MiB, the most a save writes too; a draft per file opened, and why a save was refused under the editor.
A file is written once checked: `compose.yml` by `docker compose config`, and by `docker stack config` beside a
`compose.swarm.yml` with content, `compose.swarm.yml` by `docker stack config` merged over it, with `.env.global` in its
environment, unless it is blank, which takes the app off the swarm, a `.yml`, `.yaml` or `.env` file by a read of its syntax. The compose files are written beside, as
`.compose.<pid>-<n>.pending.yml`, then renamed in place once checked; the others are rewritten in place, so that a
container that bind-mounts one sees the change. A path is refused with a 400 when it leaves the app's folder: `..`, a
segment that starts with a dot, an absolute path, a symlink that leads out of it, to nothing, or to a hidden file. A
file is checked by its own extension, not by that of a link to it, and its copy is written whole before it is copied
over the file, so that a full disk leaves the file as it was. compose's complaint is
shown as it says it, the app's files by their paths in its folder, and the values of `.env.global` and of the server's
environment of 4 characters or more replaced by `***`, as an interpolation error echoes the value at fault: it is about the operator's own file, and the only way
to say what to fix in it. A save, a new file or a new app takes its turn among the store's changes, and is refused with
a 409 while a sync runs. Edits land in the clone, as a saved `hangar.yml` does.

**Settings → Store** clones the store, or pulls it with `--ff-only` once cloned, apart from the request: the sync goes
on once the page is closed, and `GET /api/store` gives its state, which the page reads again each second while it runs.
One sync runs at a time: a second request gets the one running. While it runs, a save of `hangar.yml`, an install or an
uninstall is refused with a 409, rather than race it; those changes otherwise take turns. A sync's end is notified
(`storeInstalled`, `storeUpdated`, `storeInstallFailed`, `storeUpdateFailed`); until the notifications are kept, the
server logs them. The page shows why a sync failed, its code and its English message, never git's output, which the log
holds.

**Settings → Configuration** saves `hangar.yml` once it is valid, its users included, and links the apps and shared
files it lists; an invalid file is refused with the field at fault, and not written. **Settings → Environment** saves
`.env.global` merged into the file as it is on disk, after its copy aside, `.env.global.<time>.bak`: the page sends only
what changed since it read the file, so a variable added, changed or removed by hand meanwhile stays as the file has it,
and only the ones removed on the page are lost. A save that changes nothing writes nothing, and makes no copy. A new
variable needs a name compose takes; one the file holds already, as `OLD-KEY` written by hand, may be changed or
removed. Its values are hidden until shown, as most are secrets, and its answer is never cached (`Cache-Control:
no-store`). Both tabs read their file anew each time they open, as a sync or an install may have changed it.

### Docker

The server reaches the daemon that `DOCKER_HOST` names, `unix:///path` or `tcp://host:port` without TLS, else Docker's
own socket; a `DOCKER_HOST` it does not support, or `DOCKER_TLS_VERIFY` set, stops it at the start. **Apps** and an
app's page read the containers of the compose projects, and `GET /api/docker/overview` the usage of the whole host
(`info` and `df`), from a cache: one read of the daemon shared by the requests that wait for it, served as it is for a
minute, then served while it is read again, as the Waku version's `Cache` does; the overview, whose `df` is the
daemon's slowest call, for five minutes. A failed read is not kept, and a failed reread keeps the last value; after a
failure, the daemon is not asked again before a wait, from 2 seconds doubled up to a minute, and a failed read is
tried again once its wait has passed. The server follows the
daemon's events from its start, and reads again what they make stale, whatever that wait, the events of a quarter of a
second gathered, two seconds for the overview; when the events are followed again after the daemon went away,
everything is read again, and when the daemon refuses them for good, each value is read again as it goes stale.

A reread that changes what the cache holds is pushed to the page on `GET /api/docker/changes`, as are an install, an
uninstall, a saved `hangar.yml` and the end of a store sync, which change the apps listed; the page reads again what it
shows, and no longer reloads every 30 seconds. When that stream is lost, the page says so and connects again, after a
wait from a second doubled up to 30 seconds, then reads everything again. The stats of the installed apps' containers, a frame a second, and the log of a
container, its last 200 lines then followed, are streamed from the daemon, never kept; a log ends with an `end` event
once its container stops, and an app Hangar did not install, or an id that is not one of a container of the app, is a 404. A daemon that does not answer is a 503, `docker.unavailable`. The update badge and its filter come with the image
check (#176), the compose commands with #173, the backups with #177, and a container's console with the terminal.

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
