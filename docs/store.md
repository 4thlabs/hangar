# The store

The store is a git repository you own. It holds one folder per app, each with a `compose.yml`,
and a `hangar.yml` that groups the apps and lays out the dashboard. Hangar never writes to your
remote: it clones the repository, pulls it with `--ff-only`, and runs `docker compose` against the
files it contains.

## Layout

```
your-hangar-store/
├── config/
│   └── hangar.yml              # categories, shared files, dashboard
└── store/
    ├── networks.yml            # a shared file: listed under `shared:` in hangar.yml
    ├── jellyfin/
    │   └── compose.yml
    ├── miniflux/
    │   ├── compose.yml
    │   └── miniflux.env        # an env_file next to the compose file
    └── frigate/
        ├── compose.yml
        └── config/             # the app's own runtime configuration
```

Every entry of `store/` is an app, except the ones `hangar.yml` lists as `shared`. An app id is
its folder name: lowercase letters, digits, `.`, `_` and `-`, starting with a letter or a digit.

## An app's `compose.yml`

Any valid Compose file works. Hangar reads three things from it:

```yaml
name: Jellyfin # the display name; defaults to the capitalized folder name
x-hangar:
  icon: https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/jellyfin.webp
services:
  jellyfin: # the main service: the one named after the app, else the first one
    image: jellyfin/jellyfin:latest
    container_name: jellyfin # the container widgets and links address; defaults to the app id
    restart: unless-stopped
    volumes:
      - ${APP_DATA_DIR}/jellyfin/config:/config
    labels:
      - traefik.enable=true # served at https://jellyfin.<DOMAIN>
```

- **`name`** is only a label. The Compose project is always the app id (`-p <app>`), so the
  containers keep matching the installed app whatever the display name says.
- **`x-hangar.icon`** is the image shown in the store and on the Apps page.
  [selfh.st/icons](https://selfh.st/icons) has one for most self-hosted software.
- **`container_name`** of the main service is what Hangar links to (`https://<container>.<DOMAIN>`)
  and what widgets look up their API key under.

Every compose call passes `--env-file <data>/.env.global`, so the file can reference any variable
defined there.

You can also create and edit apps from the browser: **Store → Nouvelle app** starts from a template,
and each app has an edit page. A file is written only once `docker compose config` accepts it.
Edits land in your local clone; commit and push them from there if you want them in the remote.

## The global environment

`.env.global`, at the root of the data directory, is the environment every stack is composed
with. Hangar scans the installed apps — their `*.yml`, `*.yaml` and `*.env` files — for the
`${VAR}` and `$VAR` references they make, and adds the missing ones to the file, empty, so the
**Paramètres → Environnement** page shows you what is left to fill.

Only namespaced variables are seeded:

- `APP_*` for Hangar's shared paths. `APP_DATA_DIR` is filled in for you: `<data>/app-data`.
- `<APP>_*` for each installed app, `<APP>` being its id in uppercase. An id with a dash gives
  both spellings: `sync-in` owns `SYNCIN_*` and `SYNC_IN_*`.

Anything else, like a bare `DOMAIN` or `TZ`, is yours to add. Hangar only ever adds keys: it never
overwrites a value or removes one you did not delete yourself, and it keeps a timestamped
`.env.global.<date>.bak` copy before every write.

A widget reads its service's API key from `<CONTAINER>_API_KEY`, so `JELLYFIN_API_KEY` for the
Jellyfin widget. See [Widgets](widgets.md).

## `hangar.yml` reference

`config/hangar.yml` is validated when it is loaded and before it is saved: an invalid file is
reported with the faulty field and never written. A store without one still installs; its apps
are just left ungrouped. You can edit it in **Paramètres → Configuration**.

```yaml
categories:
  - name: Infrastructure
    color: "#64748b"
    stacks: [traefik, arcane, beszel]
  - name: Media
    color: "#a855f7"
    stacks: [jellyfin]
  - name: Home
    color: "#22c55e"
    stacks: [frigate, miniflux]

shared:
  - networks.yml

widgets:
  - { type: clock, column: 1 }
  - { type: docker-general-stats, column: 1 }
  - { type: jellyfin-latest, column: 2, user: thomas }
  - { type: frigate-events, column: 3, url: http://frigate:5000 }

registryThrottling: 100
```

### `categories`

**Required.** The groups the Apps page filters by, and the order commands run in.

| Field    | Type     | Description                                       |
| -------- | -------- | ------------------------------------------------- |
| `name`   | string   | Shown in the filters, and usable as a CLI target. |
| `color`  | string   | Any CSS color.                                    |
| `stacks` | string[] | App ids, in start order.                          |

Installing the store links every app listed here. The order matters for commands that address
several stacks: `up` and `start` go through them in order, `down` and `stop` in reverse, so a
reverse proxy listed first comes up first and goes down last. Other commands run in parallel.

### `shared`

Default `[]`. Files under `store/` that are not apps but that stacks reference, such as a Compose
fragment declaring common networks. They are linked into `app-installed/` next to the apps, so a
relative path from an app's `compose.yml` keeps resolving.

### `widgets`

Default: a clock and Docker stats in column 1, Frigate events in column 3. The dashboard, in
declaration order. Every widget takes a `type` and a `column` (`1`, `2` or `3`); the rest depends
on the type. See [Widgets](widgets.md).

### `registryThrottling`

Default `100`. Pause between two registry calls in the image update check, in milliseconds.
Docker Hub and ghcr.io rate-limit bursts; raise this if the check comes back throttled.
