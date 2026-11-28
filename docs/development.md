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
| `npm run lint` / `lint:fix`       | ESLint, on `src/` and `web/src`                |
| `npm run typegen`                 | Regenerates Waku's typed routes                |
| `npm run db:generate`             | Generates a Drizzle migration from the schemas |
| `npm run db:migrate`              | Applies the migrations to `HANGAR_DB_HOST`     |
| `npm run db:studio`               | Opens Drizzle Studio on the database           |

CI runs `format:check`, `lint`, `typecheck`, `test` and `build` on every pull request and push to
`main`, its `rust` job checks the Cargo workspace, and its `web` job builds, lints and tests the Rust
server's page (see the Rust section of
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

`npm run lint --prefix web` runs oxlint's type-aware rules on the page, once `cargo quoll gen` has written orval's
TypeScript. The page's coding rules, and what each linter checks, are in
[`docs/web/CODING_RULES.md`](web/CODING_RULES.md).

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
(`storeInstalled`, `storeUpdated`, `storeInstallFailed`, `storeUpdateFailed`). The page shows why a sync failed, its code and its English message, never git's output, which the log
holds.

**Settings → Configuration** saves `hangar.yml` once it is valid, its users included, and links the apps and shared
files it lists; an invalid file is refused with the field at fault, and not written. **Settings → Environment** saves
`.env.global` merged into the file as it is on disk, after its copy aside, `.env.global.<time>.bak`: the page sends only
what changed since it read the file, so a variable added, changed or removed by hand meanwhile stays as the file has it,
and only the ones removed on the page are lost. A save that changes nothing writes nothing, and makes no copy. A new
variable needs a name compose takes; one the file holds already, as `OLD-KEY` written by hand, may be changed or
removed. Its values are hidden until shown, as most are secrets, and its answer is never cached (`Cache-Control:
no-store`). Both tabs read their file anew each time they open, as a sync or an install may have changed it.

### Notifications

The server keeps one list of notifications for every user, as there are no roles: the last 100, in
`app-data/hangar/notifications.json`, which it reads as it starts and replaces whole at each change, written beside then
renamed in its place; it saves what is left to save once it stops serving, on `SIGTERM`. A file it cannot read as a list
is put aside, as `notifications.json.<time>.bad`, and a new list starts; a notification of a key this version does not
know is kept as it is. Each notification has an id, its level, its message as a key and its params (`storeUpdated`),
which the page words in English, the page it leads to, and whether it was seen and read; one filed with a dedupe key
replaces the one before it of that key, and comes first. The ids grow within an epoch, a random id the file holds, drawn
anew each time they start again from 1, as after a file put aside.

The navbar's bell reads the newest 30 and their epoch from `GET /api/notifications`, then follows
`GET /api/notifications/events?since=<id>&epoch=<epoch>`, which opens with the server's epoch, then gives those filed
after the newest it holds, then each new one as it is filed, pushed in process; a page of another epoch is given every
one kept, and drops what it held. A notification carries its dedupe key, by which the page drops the older one it
replaced. Each page open shows a new one as a toast, which marks it seen, so that a page opened after does not; it
counts as unread until a user closes the bell, or follows the link of one of its notifications, which marks every one
read, for everyone.

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
uninstall, a saved `hangar.yml`, the end of a store sync, and the start and the end of a compose batch, which change the apps listed; the page reads again what it
shows, and no longer reloads every 30 seconds. When that stream is lost, the page says so and connects again, after a
wait from a second doubled up to 30 seconds, then reads everything again. The stats of the installed apps' containers, a frame a second, and the log of a
container, its last 200 lines then followed, are streamed from the daemon, never kept; a log ends with an `end` event
once its container stops, and an app Hangar did not install, or an id that is not one of a container of the app, is a 404. A daemon that does not answer is a 503, `docker.unavailable`. An app the last image check found an update for has
the badge **Update**, and the filter **Update** keeps those apps or the others (see [Jobs](#jobs)). An app's page shows its
backups (see [Backups](#backups)), and a container's console comes with the terminal.

**Apps → Up**, **Restart** and **Down** run `docker compose up -d`, with `--pull always` and `--force-recreate` as Up's
menu ticks them, `restart` or `down` on the apps selected, or on an app from its page, as a batch: `POST
/api/docker/compose` checks every app first, a 400 for a name compose does not take, a 404 for an app not installed,
and none runs, then runs them one at a time in the order of `hangar.yml`, `down` in
reverse, each once, carrying on after an app that fails. Anything but a plain Up asks first. The batch runs on the
server apart from the request: closing the panel, or the page, stops nothing. A batch holds its apps until it ends, as
an install or an uninstall holds its own: another batch, an install or an uninstall of one of them is refused with a
409, `compose.app_busy`, so that an uninstall's `down` and its unlink never let a batch's `up` in between, and the
pages disable the buttons of an app a batch holds, whichever page started it. A sync of the store, which pulls and
links the files compose reads, is refused while a batch runs, `store.batch_running` naming its apps, and a batch while
a sync runs, `compose.app_busy`. Its answer is its output as it comes:
the `batch`, its apps in the order they run, a `started` per app, compose's lines, its `finished` with the app's
outcome, then an `end` with the report; the panel shows it app by app. A line goes out with the values of
`.env.global`, as it is when the batch starts, and of the server's environment, of 4 characters or more, replaced by
`***`, and the credentials of a URL taken out, as compose's complaint about a file is. After each app the server reads
the containers again, unless the daemon failed its last read and its wait runs, then notifies `composeSucceeded` or
`composeFailed`, and the `end` comes once every app is: a page told reads the new state. A failure says why as a code,
never with compose's output, which the panel shows above it. The server keeps a batch while it runs and five minutes
after, the last 20 that ended at most, listed by `GET /api/docker/compose`, with its report once ended; a page that
comes back while one runs offers its output, which `GET /api/docker/compose/<id>` reads again from its start, as far as
its last MiB, the most a batch keeps.

### Jobs

The server runs its jobs in its own process, in memory, with no Sidequest, worker or table, on crons read in its time
zone, `TZ`, else `/etc/localtime`, else UTC. The **image check** runs as the server starts, then every four hours at
the 17th minute, `17 */4 * * *`; the **update of the apps** runs every night at 04:47, `47 4 * * *`; the **backup**
of an app runs on the `schedule` of its entry in `hangar.yml` (see [Backups](#backups)). A job is its kind and its
params, `{ "kind": "backup", "params": { "app": "alpha" } }`: the backup of each app is a job of its own, with its own
cron and its own run. A job waits its turn in its queue, which runs one job at a time, in the order they were asked
for: `default` for the image check and the update of the apps, `backups` for the backups, so that a long backup holds
up no check. A job asked for while a run of it waits or runs gets that run. The crons are read as node-cron 4.6 reads them, and checked as the
`schedule` of a backup in `hangar.yml` is: five fields or six, the names, the nicknames, `L`, `W` and `#`, and the
day of the month and the day of the week both asked for. A time the clock skips or repeats is read as node-cron reads
it: a time skipped reads as the one an hour after, and a time repeated fires once, at its later occurrence east of
UTC and its earlier west of it. A cron reads the clock again each minute it waits: a clock set back once it fired
does not fire it twice, and one that moved on, as after a suspend of the host, fires it within a minute.

The image check lists the containers of the installed apps, each with its image as it was created with it, from its
inspection: the daemon's list names the image by its id once its reference names a newer one, as after another app's
pull. Then it asks the registry for the digest it serves for each reference they run, once each, through the daemon
so that its credentials apply (`GET /distribution/<ref>/json`). The calls are `registryThrottling` apart, and each
registry has 10 s to answer. A registry that does not answer, or refuses a private image, as when its credentials
were revoked, says nothing of the reference: it has no digest until a check gets one. The first 429, or a
`toomanyrequests` the daemon passes on, stops the check: the references it did not reach keep their last digest, and
are asked first next time, those no check answered before the others, then those answered the longest ago. A
reference pinned to a digest is not asked, nor an image built on the host: one of a service whose `compose.yml` has a
`build`, and, on Docker's classic image store, one with no registry digest. On containerd's, Docker 29's default,
which the daemon's info names, an image built on the host has a registry digest as a pulled one does, and only its
`build` tells it. The answers are kept in memory. An app has an update when one of its containers runs an image whose
registry digests, or its id, as on containerd's store, are not the digest the registry serves. The server compares
the image the container was created from, never its tag, as a pull moves the tag before the container is recreated.
The Docker pages show it as `updateAvailable`, and are told on `GET /api/docker/changes` when it changes. The check
notifies `updatesAvailable` when apps have an update, in place of its notification of before.

The update of the apps checks the images again, then runs `docker compose up -d --pull always` on each app the
registry has moved past. It runs them one at a time, in the order of `hangar.yml`, carries on after one that fails, and
notifies `autoUpdate` once for them all, naming those that failed. It holds its apps as a compose batch does: an
install, an uninstall or a batch of one of them is refused while it runs. It fails with `compose.app_busy`, and updates
no app, when another command holds one of them or a sync of the store runs.

**Settings → Jobs** lists the last 50 runs, the newest first, from `GET /api/jobs`: the job, its queue and its state,
when it was asked for and when it ended, and why it failed, as a code. The ids count from the time the server
started, in milliseconds, so that a page opened before a restart names no run of the new server. **Run again** asks
for the job of a run again, `POST /api/jobs/<id>/run`. **Cancel**, `POST /api/jobs/<id>/cancel`, takes a run that
waits out of its queue, and tells one that runs to stop: the image check stops at once, the update of the apps once
the app it updates is updated. The tab reads the runs again each second while one waits or runs, and every 30 seconds
otherwise, so that a run a cron asks for shows. A restart forgets the runs and the registries' answers, and the check
at the start brings the answers back. When the server stops, on `SIGTERM`, the crons end, the runs that wait are
canceled, and those that run are told to stop and waited for, with no limit of its own: a backup starts again what it
stopped before it ends. A job asked for from then on is canceled at once. A compose command that runs is not
interrupted, though: a backup that is stopping its app's services ends its `docker compose stop`, then runs its
`start`. Docker gives a container 10 seconds after `SIGTERM`, then kills it, which would leave those services down: the
container of Hangar needs a stop grace period longer than the compose stop of the apps it backs up with `stop`, as
`stop_grace_period: 2m` in its compose file.

### Backups

A backup zips the data folder of an app, `app-data/<path>` or `app-data/<app>`, as its entry in `hangar.yml`'s
`backups` says (see [the store's docs](store.md#backups)), into `app-backups/<app>/<time>.zip`, the Waku version's
archives: written as `.zip.partial`, renamed once complete, and the oldest removed beyond `keep`. Its include and
exclude globs match dotfiles, and it follows no symbolic link. With `stop`, it stops the services that run, never the
container Hangar runs in, then starts them again whatever the outcome. Its work on the disk runs on Tokio's blocking
threads, and the backups of one app take turns.

A backup with `stop` holds its app, from before it reads which services run to after it starts them again, as a
compose batch holds its own: a batch, an install, an uninstall of it, or the update of the apps, is refused meanwhile
with a 409, `compose.app_busy`, as a batch's `up` would recreate the containers and zip a live database, and a `down`
would make its `start` fail. A backup with `stop` of an app another command holds fails at once with
`compose.app_busy`, without waiting. A sync of the store does not wait for a backup, nor a backup for a sync: a backup
may run for hours. A backup without `stop` holds nothing. The update of the apps claims every app it updates at once:
while a backup with `stop` runs, the update of that night fails, and updates none.

It runs as the job `backup` of its app, in the queue `backups`, on its cron, and when **Back up now** asks for it on the
app's page, `POST /api/backups/<app>`: a 404, `backups.not_declared`, when `hangar.yml` declares no backup of it, and
a 409, `backups.queued`, while a run of it waits or runs. The crons are read from `hangar.yml` as the jobs start, and
again once it is saved or the store synced: the backup of an app it no longer gives a `schedule` has no cron. A
backup that runs six hours is canceled, `backups.timed_out`: it removes what it wrote, and starts again what it
stopped, which it is always given time for. A **Cancel** in **Settings → Jobs** stops it so too, and is no failure.

A failed backup is notified, `backupFailed`, with the code of its error, which the page words; a service it stopped
that did not start again, `backupRestartFailed`, naming the services. Its run keeps the code, for **Settings → Jobs**.

The app's page reads `GET /api/backups/<app>`: the plan `hangar.yml` declares, `null` for an app it no longer backs
up, the archives, the newest first, and the run of its backup that waits or runs, read again every two seconds while
there is one. Nothing for a name that is no app id. `GET /api/backups/<app>/<archive>` sends an archive, its name
without `.zip`, as `application/zip`, its `Content-Length` given and never compressed, saved as
`<app>-<archive>.zip`; `DELETE` removes it. Both answer a 404, `backups.unknown_archive`, for an archive that is not
there. The card shows whatever Docker answers, and nothing for an app with no backup and no archive.

### Widgets

The dashboard reads `GET /api/widgets`, the widgets `hangar.yml` places, in its order: each with its column, its link,
and a key, `<type>-<hash>` of its options but not its column, so that moving a card keeps what it loaded, a second
placement of the same options taking `-2`. Each card then reads `GET /api/widgets/<key>` on its own, a slow service
holding its card alone. A widget's service is a quoll contract of its own in `crates/server/src/widgets/`, called at
its `url`, else `https://<container>.<DOMAIN>`, the container's that the store's app declares, with its key from
`.env.global`, `<CONTAINER>_API_KEY` under either prefix of the container's name, `SYNCIN_` or `SYNC_IN_`; GitHub's
releases with `GITHUB_TOKEN`, and Finnhub's stocks with `FINNHUB_API_KEY`. Each placement's service gets a client of
its own, which sends the key as its contract's scheme says, built at its first load and again once its address or its
key changes; GitHub's and Finnhub's are built as the server starts. A call is given 10 seconds and tried again once.

What a placement loaded is kept by its key: fresh for its `ttl`, 60 seconds unless `hangar.yml` says, then served while
it loads again behind its reader for 15 minutes more, which is also how long a service that stopped answering keeps
its last card. A failed first load is not kept. Nothing is loaded without a reader: the Waku version's keep-warm loop,
which polled every widget every 30 seconds, is gone. The readers of a key share one load, which runs on its own, so a
page that leaves does not cancel it. GitHub's releases and Finnhub's calls are also kept per repository and per symbol,
as the Waku version keeps them, and shared by every placement. A service that does not answer, or not as the widget
reads it, is a 502, `widgets.unavailable`, the cause in the server's log; a key that places nothing, the clock or
Docker's stats, which load nothing here, is a 404. Docker's stats read `GET /api/docker/overview`, and the apps
due an update from `GET /api/docker/apps`, as the image check marks them, both read again as the daemon's changes come.

`GET /api/widgets/<key>/image/<id>` relays a Frigate thumbnail, a Jellyfin poster or a tcg-collector card, so that the
browser needs neither the service's address nor its key. An id is letters, digits, `_`, `.` and `-`, but not `.` or
`..`, checked rather than escaped, as it goes in the service's path. Only a raster image is relayed, JPEG, PNG, WebP,
GIF or AVIF, and one of no type as a JPEG: anything else, a page of a proxy or an SVG, which may hold a script that
would run on Hangar's origin, is a 404 like a missing image. The answer carries `X-Content-Type-Options: nosniff`, and
the browser keeps it a day, `Cache-Control: private, max-age=86400`.

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

On the Rust server, a widget is:

1. Its options in the core's `WidgetKind`, read from `hangar.yml` in `crates/core/src/store/config/widget.rs`.
2. Its data in the contract, a variant of `hangar_api::WidgetData`, and its type in `WidgetType`.
3. Its service's contract and its load in `crates/server/src/widgets/<app>.rs`, `#[server(none)]`, its key a scheme
   of the contract, `client::key` or `client::bearer` in its `Client::new`, listed in `Loader::load`, and in
   `Service::options` for a widget of a store app. A key that goes in `Authorization` in a form of its own, as
   Beszel's raw token and Jellyfin's `MediaBrowser Token="..."`, goes through `Service::authorization`: quoll's header
   schemes leave that header to its `Bearer` and `Basic`.
4. Its card in `web/src/modules/widgets/components/cards/`, its title and icon in `helpers/widget-appearance.ts`, placed by
   `DashboardPage`.
5. A test in `crates/server/tests/widgets/`, against its service faked on port 0.
