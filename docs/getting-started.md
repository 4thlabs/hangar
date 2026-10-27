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
| `FINNHUB_API_KEY`    |          | The Finnhub API key the [stock prices widget](widgets.md#stock-prices) needs.                     |
| `HANGAR_SSH_HOST`    |          | The host the [header's terminal](#terminal-on-the-host) signs in to over SSH.                     |
| `HANGAR_SSH_USER`    |          | The account it signs in as. The terminal needs both this and `HANGAR_SSH_HOST`.                   |
| `HANGAR_SSH_PORT`    |          | The SSH port, `22` by default.                                                                    |
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
    └── hangar/
        ├── hangar.db           # Hangar's own database (users, notifications, jobs)
        └── ssh/                # the host terminal's imported key, and the host keys it trusts
```

Installing an app is creating its symlink in `app-installed/`; uninstalling stops the stack, then
removes the link. The store clone itself is never touched by an install.

## First launch

1. **Create your account.** Open `http://<host>:3010` and register. Sign-in is email and password.
   This first account is the only one: once it exists, registration is closed.
2. **Install the store.** In **Paramètres → Store**, install the store: Hangar clones
   `HANGAR_STORE_URL`, links every app `hangar.yml` lists, and creates `.env.global`. The same
   button later pulls the store's latest commit.
3. **Fill in the environment.** **Paramètres → Environnement** lists every `APP_*` and `<APP>_*`
   variable the installed stacks reference and that has no value yet. `APP_DATA_DIR` is filled in
   for you.
4. **Start your apps.** On **Apps**, select stacks and bring them up.

> [!WARNING]
> Until the first account exists, anyone who reaches the sign-up page can create it, and an
> account can run `docker compose` on your host. Create yours as soon as Hangar is up, and keep
> it on a trusted network or behind an authenticating proxy.

## Terminal on the host

The terminal button in the header, beside the notifications, opens a shell on the host, over SSH:
Hangar runs in a container, so a shell of its own would be the container's. Name the account in
`.env`, then recreate Hangar's container:

```sh
HANGAR_SSH_USER="you"
# HANGAR_SSH_HOST="host.docker.internal"
# HANGAR_SSH_PORT="22"
```

The host defaults to `host.docker.internal`, which `compose.yml` maps to the machine Docker runs on
(`extra_hosts: host-gateway`), provided its `sshd` listens on the Docker bridge too (the default
`ListenAddress` covers every interface). Any other address works.

The terminal signs in the way `ssh` does, asking in the terminal itself:

- **A key**, when you imported one with **Clé SSH**: the private key of a pair the account's
  `~/.ssh/authorized_keys` lists. Hangar keeps it in `app-data/hangar/ssh/id_key`, readable by
  its owner only. A key with a passphrase asks for it at each connection.
- **The password** otherwise, or when the host refuses the key: three tries, as `ssh` gives.
  Hosts that only take `keyboard-interactive` work too, a one-time code included. What you type
  there is never stored nor logged.

On the first connection, Hangar records the host's key in `app-data/hangar/ssh/known_hosts` and
refuses a different one afterwards, as `ssh` does; **Clé SSH** shows its fingerprint. Once the host
is reinstalled, delete its line from that file.

The shell stays open when you close its window, change pages or reload, as an SSH session in
`tmux` would: reopening it, from the same tab or another one, finds it with its latest output. It
ends with `exit`, after an hour without a keystroke or output, or when you sign out of Hangar. A
container's shell, in contrast, ends when its sheet closes, or with its **Fermer la session** button.

> [!WARNING]
> Like the container terminals, the host terminal is open to every signed-in user: Hangar has no roles.
> Without an imported key, only someone who knows the account's password gets a shell; with one,
> anyone signed in to Hangar does.

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
Exclude `application/zip` too: Traefik's list replaces its own default, which leaves archives out,
and a backup gzipped again would download without its size. With Traefik:

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.hangar.middlewares=hangar-compress
  - traefik.http.middlewares.hangar-compress.compress.excludedcontenttypes=text/event-stream,application/zip
```

## Updating Hangar

Each `v*` tag publishes `X.Y.Z`, `X.Y` and `latest`. `edge` follows `main`: it is rebuilt on every
merged pull request, ahead of any release, and may break. Pin the tag you want, then:

```bash
docker compose pull
docker compose up -d
```

Or from Hangar itself: **Paramètres → Hangar → Mettre à jour Hangar** pulls the image of the tag
in your `compose.yml` and, when it changed, recreates Hangar's container. The other services of
the file are left alone. A `hangar-self-update` container runs the two commands above, since
Hangar cannot recreate the container it runs in. It stays once done, until the next update, so
`docker logs hangar-self-update` shows how the last one went.

That container runs Compose in your `compose.yml`'s folder but not in your shell: the variables
the file needs must come from the `.env` next to it, not from `export`s.

Either way, migrations run on start, so there is nothing else to do.
