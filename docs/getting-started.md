# Getting started

Hangar ships as one container image, `ghcr.io/4thlabs/hangar`, built for `linux/amd64` and
`linux/arm64`. It drives the host's Docker daemon through its socket, so the stacks it starts are
ordinary containers on the host, next to Hangar rather than inside it.

## Requirements

- A Linux host with Docker Engine and the Compose plugin.
- A git repository holding your stacks — the [store](store.md). Hangar clones it over HTTPS, so a
  private repository needs its credentials in the URL.
- A domain, if you want the dashboard to link to your apps: Hangar assumes each app is served at
  `<container>.<DOMAIN>`, as a Traefik `traefik.enable=true` label gives you by default.

## Run the container

A minimal `compose.yml`:

```yaml
services:
  hangar:
    image: ghcr.io/4thlabs/hangar:latest
    container_name: hangar
    environment:
      - PUID=${PUID:-1000}
      - PGID=${PGID:-1000}
      - DOMAIN=${DOMAIN?required}
      - HANGAR_DATA_DIR=${PWD}/.data
      - HANGAR_STORE_URL=${HANGAR_STORE_URL?required}
      - BETTER_AUTH_URL=${BETTER_AUTH_URL?required}
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET?required}
    volumes:
      - ${PWD}/.data:/app/data
      - ${PWD}/.data:${PWD}/.data
      - /var/run/docker.sock:/var/run/docker.sock
    ports:
      - 3010:3010
```

Add the networks your widgets need to reach their services on, and the labels of your reverse
proxy (see [below](#behind-a-reverse-proxy)).

> [!IMPORTANT]
> The data directory is mounted **twice, the second time at the same path as on the host**.
> Hangar asks the host's daemon to run `docker compose` on files inside it, and the daemon
> resolves every relative bind mount in those files against host paths. Mounting the directory
> at an identical path, and pointing `HANGAR_DATA_DIR` at it, is what makes a path Hangar sees
> the same path the daemon sees.

Then:

```bash
docker compose up -d
```

On start, the entrypoint applies the database migrations, then starts the server on port `3010`.
A health check polls `/login` every 30 seconds.

## Environment variables

| Variable             | Required | Description                                                                                       |
| -------------------- | :------: | ------------------------------------------------------------------------------------------------- |
| `HANGAR_STORE_URL`   |    ✓     | Git URL of your store. Cloned into `app-store/` on first install, then fast-forwarded.            |
| `DOMAIN`             |    ✓     | Base domain of your apps. A widget links to `https://<container>.<DOMAIN>` unless told otherwise. |
| `HANGAR_DATA_DIR`    |    ✓     | The data directory. The image defaults to `/app/data`; set it to the host path, as above.         |
| `HANGAR_DB_HOST`     |    ✓     | Path of the SQLite database. The image defaults to `/app/data/app-data/hangar/hangar.db`.         |
| `BETTER_AUTH_URL`    |          | The public URL Hangar is reached at, used by the sign-in flow.                                    |
| `BETTER_AUTH_SECRET` |          | At least 32 characters; signs the sessions. Generate one with `openssl rand -base64 32`.          |
| `GITHUB_TOKEN`       |          | Raises the GitHub API rate limit for the [GitHub releases widget](widgets.md#github-releases).    |
| `PUID` / `PGID`      |          | User and group id (default `1000`), inherited by the stacks' compose environment.                 |

Every variable is validated at startup: a missing or malformed one stops the server with its name
in the error, rather than surfacing later as a broken page.

These are Hangar's own variables. The variables your **stacks** need live in `.env.global`,
described below.

## The data directory

Everything Hangar keeps sits under `HANGAR_DATA_DIR`:

```
.data/
├── .env.global                 # variables shared by every stack, plus timestamped .bak copies
├── app-store/                  # the clone of your store
│   ├── config/hangar.yml
│   └── store/<app>/compose.yml
├── app-installed/              # one symlink per installed app, plus the shared files
│   └── <app> -> ../app-store/store/<app>
└── app-data/                   # APP_DATA_DIR: where stacks keep their volumes
    └── hangar/hangar.db        # Hangar's own database (users, notifications, jobs)
```

Installing an app is creating its symlink in `app-installed/`; uninstalling stops the stack, then
removes the link. The store clone itself is never touched by an install.

## First launch

1. **Create your account.** Open `http://<host>:3010` and register. Sign-in is email and password.
2. **Install the store.** In **Paramètres → Store**, install the store: Hangar clones
   `HANGAR_STORE_URL`, links every app `hangar.yml` lists, and creates `.env.global`. The same
   button later pulls the store's latest commit.
3. **Fill in the environment.** **Paramètres → Environnement** lists every `APP_*` and `<APP>_*`
   variable the installed stacks reference and that has no value yet. `APP_DATA_DIR` is filled in
   for you.
4. **Start your apps.** On **Apps**, select stacks and bring them up.

> [!WARNING]
> Registration is open to anyone who can reach the sign-up page, and an account can run
> `docker compose` on your host. Keep Hangar on a trusted network or behind an authenticating
> proxy.

## Background jobs

Two jobs run inside Hangar, scheduled at the first request the server answers:

| Job                  | Schedule       | What it does                                                                                      |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `CheckImageVersion`  | `17 */4 * * *` | Asks each registry for the digest of every image the installed apps run, and notifies on updates. |
| `UpdateOutdatedApps` | `47 4 * * *`   | Pulls and recreates every app whose registry serves a newer image, then notifies with the result. |

Both can be run by hand from **Paramètres → Jobs**, which also shows their last results. Both run
off the hour on purpose: registries rate-limit the burst of crons that fire at `:00`. If they
still throttle you, raise [`registryThrottling`](store.md#registrythrottling) in `hangar.yml`.

## Behind a reverse proxy

Hangar compresses its own responses, but static assets are served before that middleware runs,
so let the proxy compress them. Exclude `text/event-stream`: compose output, logs and stats are
streamed as server-sent events, and a buffering proxy would deliver them all at once at the end.
With Traefik:

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.hangar.middlewares=hangar-compress
  - traefik.http.middlewares.hangar-compress.compress.excludedcontenttypes=text/event-stream
```

## Updating Hangar

Each `v*` tag publishes `X.Y.Z`, `X.Y` and `latest`. Pin the tag you want, then:

```bash
docker compose pull
docker compose up -d
```

Migrations run on start, so there is nothing else to do.
