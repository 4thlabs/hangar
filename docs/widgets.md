# Widgets

The dashboard is declared in the `widgets:` section of the store's [`hangar.yml`](store.md#widgets).
Widgets render in three columns, top to bottom in the order they are declared. A type can be
placed more than once, for instance two `github-releases` blocks watching different repositories:
each card loads and caches its own data.

```yaml
widgets:
  - { type: clock, column: 1 }
  - { type: docker-general-stats, column: 1 }
  - { type: beszel-server-stats, column: 2, url: http://beszel:8090 }
  - type: github-releases
    column: 3
    repositories: [4thlabs/hangar, immich-app/immich]
```

A store that declares no `widgets:` gets a clock and Docker stats in column 1 and Frigate events
in column 3.

## Common options

| Option   | Applies to        | Description                                                                                                         |
| -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `type`   | every widget      | Which widget, from the list below.                                                                                  |
| `column` | every widget      | `1`, `2` or `3`.                                                                                                    |
| `url`    | service widgets   | Where Hangar calls the service from, server side. Prefer a container-network address such as `http://frigate:5000`. |
| `link`   | service widgets   | Where the card links to in your browser. Only needed when the app is not served at `https://<container>.<DOMAIN>`.  |
| `ttl`    | widgets that load | How long the loaded data stays fresh, in seconds. Default 60.                                                       |

## How a service widget finds its service

Each service widget reads one store app, named by the first part of its type: `frigate-events`
reads the `frigate` app. From that app Hangar takes the `container_name` of its main service, then:

- **Link:** `link`, or else `https://<container>.<DOMAIN>`.
- **API:** `url`, or else the link — the call then leaves the host and comes back through your
  reverse proxy, which works but is slower. Set `url` when Hangar shares a network with the app.
- **API key:** `<CONTAINER>_API_KEY` from `.env.global`, for instance `MINIFLUX_API_KEY`. The key
  is optional: without one, the request is sent unauthenticated.

When a service cannot be reached, the card shows an error and keeps its last good answer for up
to 15 minutes.

## Available widgets

| Type                                            | Shows                                           | Extra options                         |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------------- |
| [`clock`](#clock)                               | Date and time                                   | —                                     |
| [`docker-general-stats`](#docker-general-stats) | Containers, images, volumes and apps to update  | —                                     |
| [`arcane-general-stats`](#arcane-general-stats) | Arcane's view of the Docker host                | `url`, `link`, `ttl`                  |
| [`backrest-summary`](#backrest-summary)         | Backrest repositories and their last backups    | `url`, `link`, `ttl`                  |
| [`beszel-server-stats`](#beszel-server-stats)   | CPU, memory and disk of every Beszel system     | `url`, `link`, `ttl`                  |
| [`frigate-events`](#frigate-events)             | Latest camera events with thumbnails            | `url`, `link`, `ttl`                  |
| [`gluetun-vpn-status`](#gluetun-vpn-status)     | Whether the VPN tunnel is up and where it exits | `url`, `link`, `ttl`                  |
| [`jellyfin-latest`](#jellyfin-latest)           | Recently added movies, episodes and albums      | `user`, `url`, `link`, `ttl`          |
| [`miniflux-entries`](#miniflux-entries)         | Newest feed entries and the unread count        | `url`, `link`, `ttl`                  |
| [`tcg-collector-cards`](#tcg-collector-cards)   | Trading card prices and their recent curves     | `cards`, `days`, `url`, `link`, `ttl` |
| [`github-releases`](#github-releases)           | Latest release of each repository               | `repositories`, `ttl`                 |

### `clock`

The date and time, from the visitor's own clock. Loads nothing.

### `docker-general-stats`

Running and stopped containers, images, volumes and the store apps due an image update,
straight from the Docker daemon Hangar is connected to. It follows the daemon's events, so it has
no `ttl`.

### `arcane-general-stats`

The same host counts, as [Arcane](https://getarcane.app) reports them for its first environment.
Key: an Arcane API key in `ARCANE_API_KEY`, sent as `X-API-Key`.

### `backrest-summary`

Each [Backrest](https://github.com/garethgeorge/backrest) repository with the outcome and time of its last run.
Key: `BACKREST_API_KEY`, sent as `X-API-Key`.

### `beszel-server-stats`

Every system a [Beszel](https://beszel.dev) hub monitors, with its CPU, memory and disk usage.
Key: a Beszel API token in `BESZEL_API_KEY`, sent as `Authorization`.

### `frigate-events`

The five latest [Frigate](https://frigate.video) events. Thumbnails are relayed by Hangar, so they
load even when `url` is a container-network address; event links use `link`.
Key: `FRIGATE_API_KEY`, sent as `X-API-Key`, if your Frigate requires one.

### `gluetun-vpn-status`

Whether the [gluetun](https://github.com/qdm12/gluetun) tunnel is up, its public IP and location,
read from the control server. Gluetun has no web page, so the card has no header link.
Key: `GLUETUN_API_KEY`, sent as `X-API-Key`.

### `jellyfin-latest`

Library counts and the latest items added to [Jellyfin](https://jellyfin.org).

```yaml
- { type: jellyfin-latest, column: 2, user: thomas, url: http://jellyfin:8096 }
```

`user` is **required**: Jellyfin scopes "latest" to what a given user may see. Give the user's
name as it appears in Jellyfin.
Key: a Jellyfin API key in `JELLYFIN_API_KEY`, sent as `Authorization: MediaBrowser Token="…"`.

### `miniflux-entries`

The eight newest [Miniflux](https://miniflux.app) entries, unread ones marked, and the unread count.
Key: a Miniflux API token in `MINIFLUX_API_KEY`, sent as `X-Auth-Token`.

### `tcg-collector-cards`

Trading cards tracked by [tcg-collector](https://github.com/4thlabs/tcg-collector), one row each
in the order they are listed: the card's image, its name and version (V.1, V.2…), its expansion,
its current Cardmarket prices (trend, low, foil trend when it has one) and a curve of the trend
over the last `days`, or of the low price for a card Cardmarket gives no trend. The name opens the
card's sheet on the tcg-collector page. One list can mix games.

```yaml
- type: tcg-collector-cards
  column: 2
  url: http://tcg-collector-web:8080 # the web page's container, on Hangar's network
  link: https://cards.example.com # the tcg-collector page, which the rows link to
  days: 30 # optional, the period of the curves, 1 to 3650; default 30
  cards:
    - { game: 1, product: 910771 } # game: Cardmarket game id, 1 = Magic, 21 = Star Wars Unlimited
    - { game: 21, product: 755143 } # product: the version followed, its Cardmarket idProduct
```

`cards` is **required**: one to twenty, each with its `game` and its `product`. Every version of
a card has its own product id. To find it, open the card in the tcg-collector page: the id shows
in its sheet, and in the address as `card=`. A product tcg-collector does not know gets a row
saying so; the other cards still show.

The widget reads the `tcg-collector` app, whose main container is the collector, which serves no
HTTP: the page runs in the `tcg-collector-web` container. Set both `url` and `link`, or the card
calls an address nothing answers. Images are relayed by Hangar.
Key: none, tcg-collector's API takes no authentication.

### `github-releases`

The latest release of each repository, newest first.

```yaml
- type: github-releases
  column: 3
  repositories: [4thlabs/hangar, immich-app/immich]
```

`repositories` is **required**, at least one, each written `owner/repo`. Anonymous calls to the
GitHub API are limited to 60 an hour; set `GITHUB_TOKEN` in Hangar's own environment to lift that.
