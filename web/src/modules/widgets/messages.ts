import type { WidgetType } from "#libs/api";
import { formatCount, formatInteger } from "#modules/widgets/helpers/widget-format.ts";

/** What `widgets` says: the dashboard, the states of a widget's card, and each card. */
export const widgetsMessages = {
  dashboard: {
    documentTitle: "Dashboard | Hangar",
    readFailed: "Could not read the dashboard",
  },
  /** What names each widget on its card, its skeleton and its error state. */
  looks: {
    clock: { title: "Clock", errorDescription: "The clock could not be rendered." },
    "docker-general-stats": { title: "Local", errorDescription: "The local Docker statistics could not be loaded." },
    "arcane-general-stats": { title: "Arcane", errorDescription: "The general statistics could not be loaded." },
    "backrest-summary": { title: "Backrest", errorDescription: "The backup status could not be loaded." },
    "beszel-server-stats": { title: "Beszel", errorDescription: "The server stats could not be loaded." },
    "forgejo-ci": { title: "Forgejo", errorDescription: "The Forgejo Actions runs could not be loaded." },
    "frigate-events": { title: "Frigate", errorDescription: "The camera events could not be loaded." },
    "gluetun-vpn-status": { title: "Gluetun", errorDescription: "The VPN status could not be read." },
    "miniflux-entries": { title: "Miniflux", errorDescription: "The feed entries could not be loaded." },
    "jellyfin-latest": { title: "Jellyfin", errorDescription: "The Jellyfin library could not be loaded." },
    "tcg-collector-cards": { title: "TCG Collector", errorDescription: "The card prices could not be loaded." },
    "github-releases": { title: "Releases", errorDescription: "The GitHub releases could not be loaded." },
    "stock-prices": { title: "Stocks", errorDescription: "The stock prices could not be loaded." },
  } satisfies Record<WidgetType, { title: string; errorDescription: string }>,
  states: {
    loading: ({ title }: { title: string }) => `Loading ${title}`,
    unavailable: ({ title }: { title: string }) => `${title} is unavailable`,
    cardFailed: "The card could not show what its service answered.",
  },
  counts: {
    containers: ({ count }: { count: number }) => formatCount(count, "container", "containers"),
    repos: ({ count }: { count: number }) => formatCount(count, "repo", "repos"),
    servers: ({ count }: { count: number }) => formatCount(count, "server", "servers"),
    cameras: ({ count }: { count: number }) => formatCount(count, "camera", "cameras"),
    tickers: ({ count }: { count: number }) => formatCount(count, "ticker", "tickers"),
    cards: ({ count }: { count: number }) => formatCount(count, "card", "cards"),
    days: ({ count }: { count: number }) => formatCount(count, "day", "days"),
  },
  host: {
    running: "Running",
    stopped: "Stopped",
    images: "Images",
    imagesDetail: ({ unused, size }: { unused: number; size: string }) => `${formatInteger(unused)} unused · ${size}`,
    volumes: "Volumes",
    volumesDetail: ({ inUse, unused }: { inUse: number; unused: number }) =>
      `${formatInteger(inUse)} in use · ${formatInteger(unused)} unused`,
  },
  arcane: {
    needsAttention: "Needs attention",
  },
  backrest: {
    empty: "No repositories configured.",
    noBackup: "No backup yet",
    protected: ({ size }: { size: string }) => `${size} protected`,
    added: ({ size }: { size: string }) => `${size} added`,
    successes: ({ count }: { count: number }) => `${formatInteger(count)} ok / 30d`,
    next: ({ when }: { when: string }) => `next ${when}`,
  },
  beszel: {
    empty: "No servers monitored.",
    down: ({ count }: { count: number }) => `${formatInteger(count)} down`,
    up: ({ since }: { since: string }) => `${since} up`,
    cpu: "CPU",
    memory: "RAM",
    disk: "Disk",
  },
  docker: {
    version: ({ version }: { version: string }) => `Docker ${version}`,
    updatesAvailable: "Updates available",
  },
  forgejo: {
    empty: "Nothing running.",
    running: ({ count }: { count: number }) => `${formatInteger(count)} running`,
    queued: ({ count }: { count: number }) => `${formatInteger(count)} queued`,
    recentlyUpdated: "Recently updated",
  },
  frigate: {
    empty: "No recent events.",
    detections: ({ perSecond }: { perSecond: string }) => `${perSecond} det/s`,
    inferenceTime: ({ detector }: { detector: string }) => `${detector} detector inference time`,
  },
  github: {
    empty: "No releases found.",
  },
  gluetun: {
    connected: "Your VPN is connected!",
    disconnected: "Your VPN is not connected!",
  },
  jellyfin: {
    empty: "No items found.",
    movies: ({ count }: { count: number }) => formatCount(count, "movie", "movies"),
    shows: ({ count }: { count: number }) => formatCount(count, "show", "shows"),
    episodes: ({ count }: { count: number }) => formatCount(count, "episode", "episodes"),
    songs: ({ count }: { count: number }) => formatCount(count, "song", "songs"),
  },
  miniflux: {
    empty: "No entries.",
    unread: ({ count }: { count: number }) => `${formatInteger(count)} unread`,
    unreadMark: "Unread",
  },
  stocks: {
    closes: ({ from, to }: { from: string; to: string }) => `Closes over the last month: from ${from} to ${to}`,
    high: ({ amount }: { amount: string }) => `H ${amount}`,
    low: ({ amount }: { amount: string }) => `L ${amount}`,
    open: ({ amount }: { amount: string }) => `O ${amount}`,
    best: "Best",
    worst: "Worst",
    rising: "Rising",
    risingOf: ({ count }: { count: number }) => `of ${formatInteger(count)}`,
  },
  tcg: {
    /** The games tcg-collector collects, by name. */
    games: {
      magic: "Magic",
      starWarsUnlimited: "Star Wars Unlimited",
    },
    game: ({ game }: { game: number }) => `Game ${game}`,
    trend: "Trend",
    low: "Low",
    lowPrice: ({ price }: { price: string }) => `Low ${price}`,
    foilPrice: ({ price }: { price: string }) => `Foil ${price}`,
    version: ({ version }: { version: number }) => `V.${version}`,
    series: ({ label, days }: { label: string; days: number }) => `${label} over ${formatCount(days, "day", "days")}`,
    seriesAt: ({ period, price }: { period: string; price: string }) => `${period}: ${price}`,
    seriesFromTo: ({ period, from, to }: { period: string; from: string; to: string }) =>
      `${period}: from ${from} to ${to}`,
    notFound: "Card not found",
    product: ({ product }: { product: number }) => `product ${product}`,
    asOf: ({ day }: { day: string }) => `as of ${day}`,
  },
} as const;
