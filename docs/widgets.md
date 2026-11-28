# Widgets

The dashboard is declared in the `widgets:` section of the store's [`hangar.yml`](store.md#widgets).
Widgets render in three columns, top to bottom in the order they are declared. A type can be
placed more than once, for instance two `github-releases` blocks watching different repositories.
Cards that read the same service share its calls: two cards on one Jellyfin ask it once.

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
| `ttl`    | widgets that load | How long what the card reads stays fresh, in seconds. Default 1800, 30 minutes.                                     |

## How a service widget finds its service

Each service widget reads one store app, named by the first part of its type: `frigate-events`
reads the `frigate` app. From that app Hangar takes the `container_name` of its main service, then:

- **Link:** `link`, or else `https://<container>.<DOMAIN>`.
- **API:** `url`, or else the link — the call then leaves the host and comes back through your
  reverse proxy, which works but is slower. Set `url` when Hangar shares a network with the app.
- **API key:** `<CONTAINER>_API_KEY` from `.env.global`, for instance `MINIFLUX_API_KEY`. The key
  is optional: without one, the request is sent unauthenticated.

When a service cannot be reached, the card keeps its last good answer for 15 minutes past its
`ttl`, 45 minutes from when it was read by default, then shows an error.

## Available widgets

| Type                                            | Shows                                           | Extra options                         |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------------- |
| [`clock`](#clock)                               | Date and time                                   | —                                     |
| [`docker-general-stats`](#docker-general-stats) | Containers, images, volumes and apps to update  | —                                     |
| [`arcane-general-stats`](#arcane-general-stats) | Arcane's view of the Docker host                | `url`, `link`, `ttl`                  |
| [`backrest-summary`](#backrest-summary)         | Backrest repositories and their last backups    | `url`, `link`, `ttl`                  |
| [`beszel-server-stats`](#beszel-server-stats)   | CPU, memory and disk of every Beszel system     | `url`, `link`, `ttl`                  |
| [`forgejo-ci`](#forgejo-ci)                     | What Forgejo Actions runs, repos updated last   | `owners`, `url`, `link`, `ttl`        |
| [`frigate-events`](#frigate-events)             | Latest camera events with thumbnails            | `url`, `link`, `ttl`                  |
| [`gluetun-vpn-status`](#gluetun-vpn-status)     | Whether the VPN tunnel is up and where it exits | `url`, `link`, `ttl`                  |
| [`jellyfin-latest`](#jellyfin-latest)           | Recently added movies, episodes and albums      | `user`, `url`, `link`, `ttl`          |
| [`miniflux-entries`](#miniflux-entries)         | Newest feed entries and the unread count        | `url`, `link`, `ttl`                  |
| [`tcg-collector-cards`](#tcg-collector-cards)   | Trading card prices and their recent curves     | `cards`, `days`, `url`, `link`, `ttl` |
| [`github-releases`](#github-releases)           | Latest release of each repository               | `repositories`, `ttl`                 |
| [`stock-prices`](#stock-prices)                 | Stock quotes, the day's moves and their curves  | `tickers`, `ttl`                      |

### `clock`

The date and time, from the visitor's own clock. Loads nothing.

### `docker-general-stats`

Running and stopped containers, images, volumes and the installed apps due an image update,
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

### `forgejo-ci`

How many repositories [Forgejo](https://forgejo.org) holds, every Actions run that is running or
queued, and the three repositories updated last (archived ones left out). Forgejo has no
instance-wide list of runs, so Hangar asks each repository that has Actions enabled (archived and
empty ones excluded): one call per repository per refresh. A repository whose runs cannot be
listed is skipped and logged.

```yaml
- { type: forgejo-ci, column: 2, url: http://forgejo:3000, owners: [thomas, 4thlabs] }
```

`owners` limits the card to the repositories of these users and organizations. Without it, the
card covers every repository the key can see, other people's public ones included. An owner the
key cannot see is skipped and logged.

Key: a Forgejo access token in `FORGEJO_API_KEY`, sent as `Authorization: token …`, with the
`read:repository` scope. Without one, only public repositories are counted and listed.

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

`repositories` is **required**, at least one, each written `owner/repo`. GitHub limits calls, 60
an hour without a token: each repository is asked once per `ttl`, and a longer `ttl` keeps the card
under it. Set `GITHUB_TOKEN` in Hangar's own environment to lift the limit.

### `stock-prices`

Up to ten stocks from [Finnhub](https://finnhub.io), in the order they are listed: the symbol, the
company's name, the last price in the currency the stock is quoted in, the change since the
previous close, the day's high, low and open, and a curve of the closes over the last month. Above
them, the day's best and worst change and how many stocks rose. Prices are not converted: a card
that mixes `AAPL` and `AIR.PA` shows dollars next to euros.

```yaml
- type: stock-prices
  column: 3
  tickers: [AAPL, MSFT, BRK.B, AIR.PA]
```

`tickers` is **required**: one to ten distinct symbols, written as Finnhub writes them, in capitals.
A listing outside the US carries its exchange suffix (`AIR.PA` for Paris, `SHOP.TO` for Toronto).
A symbol Finnhub does not know is left out of the card and named in the logs; the other stocks
still show.

The widget reads the public Finnhub API, not a store app: no `url` or `link`. Set
`FINNHUB_API_KEY` in Hangar's own environment, a key from a free Finnhub account; without one the
card shows an error. The free plan does not include the daily closes: on that plan the card shows
no curves.
Finnhub limits calls (60 a minute on the free plan): each symbol is asked three times per `ttl`,
for its quote, its company and its closes, and a longer `ttl` keeps the card under it.

## How the cards read their services

Hangar's server knows the services, and the page the cards. Each service has one route,
`/api/services/<service>/<key>`, where `<key>` names the card's placement, and a card asks it the
parts it shows, as `?counts=true&latest=100` for Jellyfin's counts and its hundred latest items:
the answer holds those parts, the others empty. A part is one call of the service, kept by that
call for the widget's `ttl`: two cards asking the same call share it, and a card asking another
limit makes another call. A card may ask only booleans and limits; what names data, a user, the
symbols, the repositories or the cards, comes from `hangar.yml`. Images are relayed by
`/api/services/images/<key>/<id>`, for the ids the server wrote, and only from the card's own
service.

## Adding a widget

A widget on parts a service already has adds no route and no service type. It is its type and
options in the core's `WidgetKind`, its `WidgetType` in the contract and its arm of `Declared::of`
on the server; and on the page a card in `web/src/modules/widgets/components/cards/`, which writes
its entry with `defineWidget` and reads its parts through `ServiceWidget`, a line in
`web/src/modules/widgets/widgets-registry.ts`, and what it does with the parts, how many and in
which order, in a helper of `web/src/modules/widgets/helpers/` with its test.

## Adding a service

A service, or a new part of one, is a change of the server too: its read and its data in the
contract, its calls on the server, each part kept by its call, its route, and its read on the
page. [`development.md`](development.md#adding-a-widget) lists the places.
