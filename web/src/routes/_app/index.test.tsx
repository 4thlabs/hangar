import { focusManager } from "@tanstack/react-query";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getServicesGluetunQueryKey,
  type DockerChange,
  type DockerOverview,
  type FinnhubData,
  type FrigateData,
  type GluetunData,
  type JellyfinItem,
  type ProjectSummary,
  type WidgetPlacement,
} from "#libs/api";
import {
  getDockerOverviewMockHandler,
  getDockerProjectsMockHandler,
  getJobsListMockHandler,
  getServicesArcaneMockHandler,
  getServicesBackrestMockHandler,
  getServicesBeszelMockHandler,
  getServicesFinnhubMockHandler,
  getServicesForgejoMockHandler,
  getServicesFrigateMockHandler,
  getServicesGithubMockHandler,
  getServicesGluetunMockHandler,
  getServicesJellyfinMockHandler,
  getServicesMinifluxMockHandler,
  getServicesTcgCollectorMockHandler,
  getStoreStatusMockHandler,
  getWidgetsPlacementsMockHandler,
} from "#libs/api/mock";
import { coded, countCalls, feed, network } from "#mock/network.ts";
import { renderAt } from "#mock/page.tsx";

const placements: WidgetPlacement[] = [
  { key: "clock-1", type: "clock", column: 1, link: null },
  { key: "docker-general-stats-1", type: "docker-general-stats", column: 1, link: null },
  { key: "gluetun-vpn-status-1", type: "gluetun-vpn-status", column: 2, link: "https://gluetun.example.com" },
  { key: "frigate-events-1", type: "frigate-events", column: 3, link: "https://frigate.example.com" },
  { key: "miniflux-entries-1", type: "miniflux-entries", column: 3, link: "https://miniflux.example.com" },
];

const gluetun: GluetunData = {
  publicIp: { publicIp: "203.0.113.7", city: "Amsterdam", country: "Netherlands" },
};

const frigate: FrigateData = {
  stats: { cameraCount: 2, detectionFps: 4.25, detectors: [{ name: "coral", inferenceSpeed: 8.5 }] },
  events: [
    {
      id: "1700000000.5-abc",
      thumbnailId: "thumbnail.1700000000.5-abc",
      camera: "frigate_front_door",
      label: "person",
      subLabel: "Ana",
      startTime: "2023-11-14T22:13:20.500Z",
    },
  ],
};

const overview: DockerOverview = {
  version: "29.0.1",
  memory: 16_000_000_000,
  containers: { total: 12, running: 10, stopped: 2 },
  images: { total: 20, unused: 3, size: 4_509_715_660 },
  volumes: { total: 8, inUse: 6, unused: 2 },
};

/**
 * Finnhub's parts: Apple's, or, when `isBroken`, quotes that are no list, which the contract refuses and the card cannot
 * render.
 */
function stocks({ isBroken }: { isBroken: boolean }): FinnhubData {
  if (isBroken) {
    // Cast: the contract refuses this body, which a server newer or older than the page may send, and the card must
    // fail on it alone.
    return { quotes: {}, profiles: [], closes: [] } as unknown as FinnhubData;
  }

  return {
    quotes: [{ symbol: "AAPL", price: 190.5, changePercent: 1.06, high: 191, low: 187, open: 188 }],
    profiles: [{ symbol: "AAPL", name: "Apple Inc", currency: "USD" }],
    closes: [{ symbol: "AAPL", closes: [] }],
  };
}

/** gluetun's answer: where it exits, or, when `isGluetunDown`, its service failing. */
function gluetunAnswer(isGluetunDown: boolean): GluetunData {
  if (isGluetunDown) {
    throw coded(502, {
      code: "widgets.unavailable",
      params: { widget: "gluetun-vpn-status" },
      message: "the gluetun-vpn-status widget could not be loaded.",
    });
  }

  return gluetun;
}

/** Miniflux's answer: its service failing. */
function minifluxDown(): never {
  throw coded(502, {
    code: "widgets.unavailable",
    params: { widget: "miniflux-entries" },
    message: "the miniflux-entries widget could not be loaded. See the server's log.",
  });
}

/**
 * What the dashboard of `shown` calls: its widgets' data, Docker's host and its apps, none installed, and the Docker
 * changes feed, `changes`.
 */
function dashboard({
  shown = placements,
  isGluetunDown = () => false,
  apps = [],
}: { shown?: WidgetPlacement[]; isGluetunDown?: () => boolean; apps?: ProjectSummary[] } = {}) {
  const changes = feed<DockerChange>("/api/docker/changes");

  network.use(
    getWidgetsPlacementsMockHandler(shown),
    getServicesGluetunMockHandler(() => gluetunAnswer(isGluetunDown())),
    getServicesFrigateMockHandler(frigate),
    getServicesMinifluxMockHandler(minifluxDown),
    getDockerOverviewMockHandler(overview),
    getDockerProjectsMockHandler(apps),
    changes.handler,
  );

  return { changes };
}

/** The card whose header says `title`, once loaded: its skeleton says the same. */
async function card(title: string): Promise<HTMLElement> {
  return await waitFor(() => {
    const loaded = screen
      .getAllByText(title.toUpperCase())
      .map(header => header.closest("[data-slot=card]"))
      .find(found => found !== null && !found.hasAttribute("aria-busy"));

    expect(loaded).toBeDefined();

    return loaded as HTMLElement;
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("/", () => {
  it("places each widget in its column, in the order of hangar.yml", async () => {
    dashboard();
    renderAt("/");

    await card("Frigate");

    const columns = screen.getByRole("main").querySelectorAll(":scope > div");

    const titles = (column: Element | undefined) =>
      [...(column?.querySelectorAll("[data-slot=card-title]") ?? [])].map(title => title.textContent);

    // The clock has no header.
    expect(columns).toHaveLength(3);
    expect(titles(columns[0])).toEqual(["LOCAL"]);
    expect(titles(columns[1])).toEqual(["GLUETUN"]);
    expect(titles(columns[2])).toEqual(["FRIGATE", "MINIFLUX"]);
  });

  it("shows what each widget loaded, its link to its service and its images relayed by the server", async () => {
    dashboard();
    renderAt("/");

    const frigateCard = await card("Frigate");

    expect(within(frigateCard).getByText("2 cameras")).toBeDefined();
    expect(
      within(frigateCard)
        .getByRole("link", { name: /FRIGATE/ })
        .getAttribute("href"),
    ).toBe("https://frigate.example.com");

    expect(within(frigateCard).getByRole("link", { name: "person · Ana" }).getAttribute("href")).toBe(
      "https://frigate.example.com/explore?event_id=1700000000.5-abc",
    );

    expect(frigateCard.querySelector("li img")?.getAttribute("src")).toBe(
      "/api/services/images/frigate-events-1/thumbnail.1700000000.5-abc",
    );

    expect(await screen.findByText("Your VPN is connected!")).toBeDefined();
    expect(screen.getByText("203.0.113.7 - Amsterdam, Netherlands")).toBeDefined();
  });

  it("shows Jellyfin's counts and a poster per show, read from its service with the parts its card shows", async () => {
    const asked: string[] = [];

    const item = (id: string, kind: string, fields: Partial<JellyfinItem>): JellyfinItem => ({
      id,
      kind,
      name: id,
      seriesId: null,
      seriesName: null,
      albumArtist: null,
      productionYear: null,
      imageId: null,
      ...fields,
    });

    network.use(
      getWidgetsPlacementsMockHandler([
        { key: "jellyfin-latest-1", type: "jellyfin-latest", column: 2, link: "https://jellyfin.example.com" },
      ]),
      getServicesJellyfinMockHandler(({ request }) => {
        asked.push(new URL(request.url).search);

        return {
          counts: { movies: 120, series: 30, episodes: 900, songs: 4000 },
          latest: [
            item("e1", "Episode", { seriesId: "s1", seriesName: "A Show", imageId: "poster.s1" }),
            item("e2", "Episode", { seriesId: "s1", seriesName: "A Show", imageId: "poster.s1" }),
            item("m1", "Movie", { name: "A Film", productionYear: 2024, imageId: "poster.m1" }),
          ],
        };
      }),
    );

    renderAt("/");

    const jellyfin = await card("Jellyfin");
    const posters = within(jellyfin).getAllByRole("listitem");

    expect(within(jellyfin).getByText("120 movies")).toBeDefined();
    expect(posters.map(poster => poster.textContent)).toEqual(["A Show", "A Film2024"]);
    expect(posters[0]?.querySelector("img")?.getAttribute("src")).toBe(
      "/api/services/images/jellyfin-latest-1/poster.s1",
    );

    expect(posters[0]?.querySelector("a")?.getAttribute("href")).toBe(
      "https://jellyfin.example.com/web/#/details?id=s1",
    );

    expect(asked).toEqual(["?counts=true&latest=100"]);
  });

  it("shows each other card from the parts its read asks of its service", async () => {
    const asked: string[] = [];

    const read =
      <T,>(answer: T) =>
      ({ request }: { request: Request }) => {
        const url = new URL(request.url);

        asked.push(`${url.pathname}${url.search}`);

        return answer;
      };

    network.use(
      getWidgetsPlacementsMockHandler([
        { key: "arcane-general-stats-1", type: "arcane-general-stats", column: 1, link: null },
        { key: "backrest-summary-1", type: "backrest-summary", column: 1, link: null },
        { key: "beszel-server-stats-1", type: "beszel-server-stats", column: 2, link: null },
        { key: "forgejo-ci-1", type: "forgejo-ci", column: 2, link: null },
        { key: "github-releases-1", type: "github-releases", column: 3, link: null },
        { key: "tcg-collector-cards-1", type: "tcg-collector-cards", column: 3, link: null },
        { key: "frigate-events-1", type: "frigate-events", column: 3, link: null },
        { key: "miniflux-entries-1", type: "miniflux-entries", column: 3, link: null },
      ]),
      getServicesFrigateMockHandler(read(frigate)),
      getServicesMinifluxMockHandler(
        read({
          unread: 3,
          entries: [
            {
              id: 9,
              title: "A new post",
              url: "https://blog.example.com/9",
              feedTitle: "A blog",
              publishedAt: "2026-11-25T08:00:00+01:00",
              isUnread: true,
            },
          ],
        }),
      ),
      getServicesArcaneMockHandler(
        read({
          dashboard: {
            version: { current: "v1.1.0", newest: null, updateAvailable: false, releaseUrl: null },
            containers: { total: 3, running: 2, stopped: 1 },
            images: { total: 1, unused: 0, size: 1 },
            volumes: { total: 0, inUse: 0, unused: 0 },
            actionItems: [{ kind: "image_update", severity: "warning", count: 4 }],
          },
        }),
      ),
      getServicesBackrestMockHandler(
        read({
          repositories: [
            {
              id: "nas",
              status: "SUCCESS",
              health: "healthy" as const,
              lastRunAt: null,
              successes: 1,
              bytesAdded: 0,
              protectedBytes: 0,
              nextBackupAt: null,
            },
          ],
        }),
      ),
      getServicesBeszelMockHandler(
        read({
          systems: [
            {
              id: "a1",
              name: "the-nas",
              status: "up",
              up: true,
              uptime: null,
              cpu: 1,
              memory: 1,
              disk: 1,
              temperature: null,
              cpuModel: null,
            },
          ],
        }),
      ),
      getServicesForgejoMockHandler(
        read({
          repositories: [
            {
              fullName: "ana/hangar",
              url: "https://f.example.com/ana/hangar",
              updatedAt: "2026-11-25T09:00:00Z",
              archived: false,
            },
          ],
          runs: [
            {
              id: 1,
              repository: "ana/hangar",
              title: "Run 1",
              status: "running",
              reference: "main",
              url: "https://f.example.com/ana/hangar/actions/runs/1",
              createdAt: "2026-11-26T08:00:00Z",
              startedAt: null,
            },
          ],
        }),
      ),
      getServicesGithubMockHandler(
        read({
          releases: [
            {
              repository: "glanceapp/glance",
              tag: "v0.9.0",
              url: "https://github.com/glanceapp/glance/releases/tag/v0.9.0",
              publishedAt: "2026-11-25T10:00:00Z",
            },
          ],
        }),
      ),
      getServicesTcgCollectorMockHandler(
        read({
          cards: [
            {
              game: 21,
              product: 7,
              imageId: "card.21-7",
              card: { name: "Luke Skywalker", expansion: null, version: null, trend: 12.5, low: 9.9, trendFoil: null },
            },
          ],
          prices: { days: 14, cards: [{ game: 21, product: 7, history: [] }] },
        }),
      ),
    );

    renderAt("/");

    expect(await within(await card("Arcane")).findByText("image_update")).toBeDefined();
    expect(within(await card("Backrest")).getByText("nas")).toBeDefined();
    expect(within(await card("Beszel")).getByText("the-nas")).toBeDefined();
    expect(within(await card("Forgejo")).getAllByText("ana/hangar")).toHaveLength(2);
    expect(within(await card("Releases")).getByText("glanceapp/glance")).toBeDefined();

    const tcg = await card("TCG Collector");

    expect(within(tcg).getByText("Luke Skywalker")).toBeDefined();
    expect(tcg.querySelector("li img")?.getAttribute("src")).toBe(
      "/api/services/images/tcg-collector-cards-1/card.21-7",
    );

    const miniflux = await card("Miniflux");

    expect(within(miniflux).getByText("A new post")).toBeDefined();
    expect(within(miniflux).getByText("3 unread")).toBeDefined();
    expect(within(await card("Frigate")).getByText("2 cameras")).toBeDefined();
    // The limits are the cards' own: five events, eight entries.
    expect(asked.toSorted()).toEqual([
      "/api/services/arcane/arcane-general-stats-1?dashboard=true",
      "/api/services/backrest/backrest-summary-1?repositories=true",
      "/api/services/beszel/beszel-server-stats-1?systems=true",
      "/api/services/forgejo/forgejo-ci-1?repositories=true&runs=true",
      "/api/services/frigate/frigate-events-1?stats=true&events=5",
      "/api/services/github/github-releases-1?releases=true",
      "/api/services/miniflux/miniflux-entries-1?unread=true&entries=8",
      "/api/services/tcg-collector/tcg-collector-cards-1?cards=true&prices=true",
    ]);
  });

  it("shows Docker's host from the Docker routes", async () => {
    dashboard();
    renderAt("/");

    const docker = await card("Local");

    expect(await within(docker).findByText("Docker 29.0.1")).toBeDefined();
    expect(within(docker).getByText("3 unused · 4.2 GB")).toBeDefined();
  });

  it("lists the installed apps the image check found an update for, each linked to its page", async () => {
    const app = (name: string, updateAvailable: boolean): ProjectSummary => ({
      name,
      icon: null,
      category: null,
      status: "running",
      serviceCount: 1,
      runningCount: 1,
      unhealthyCount: 0,
      containerIds: [`${name}-1`],
      updateAvailable,
    });

    dashboard({
      shown: placements.filter(placement => placement.type === "docker-general-stats"),
      apps: [app("miniflux", true), app("frigate", false), app("jellyfin", true)],
    });

    renderAt("/");

    const docker = await card("Local");
    const links = await within(docker).findAllByRole("link");

    expect(within(docker).getByText("Updates available")).toBeDefined();
    expect(links.map(link => [link.textContent, link.getAttribute("href")])).toEqual([
      ["jellyfin", "/apps/jellyfin"],
      ["miniflux", "/apps/miniflux"],
    ]);
  });

  it("shows a widget whose service failed as unavailable, at once, beside the others", async () => {
    const calls = countCalls();

    dashboard();
    renderAt("/");

    expect(await screen.findByText("Miniflux is unavailable")).toBeDefined();
    expect(screen.getByText("Its service did not answer. See the server's log.")).toBeDefined();
    expect(calls("GET /api/services/miniflux/miniflux-entries-1")).toBe(1);
    expect(screen.getByText("Your VPN is connected!")).toBeDefined();
  });

  it("shows a card that cannot render what its service answered as unavailable, beside the others", async () => {
    network.use(
      getWidgetsPlacementsMockHandler([
        { key: "gluetun-vpn-status-1", type: "gluetun-vpn-status", column: 2, link: null },
        { key: "stock-prices-1", type: "stock-prices", column: 3, link: null },
      ]),
      // A body with no stocks, which the contract refuses: the card cannot render it.
      getServicesGluetunMockHandler(gluetun),
      getServicesFinnhubMockHandler(stocks({ isBroken: true })),
    );

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderAt("/");

    expect(await screen.findByText("Stocks is unavailable")).toBeDefined();
    expect(screen.getByText("The card could not show what its service answered.")).toBeDefined();
    expect(await screen.findByText("Your VPN is connected!")).toBeDefined();
  });

  it("shows a card that threw once again, when its data is read again and renders", async () => {
    let isBroken = true;

    network.use(
      getWidgetsPlacementsMockHandler([{ key: "stock-prices-1", type: "stock-prices", column: 3, link: null }]),
      getServicesFinnhubMockHandler(() => stocks({ isBroken })),
    );

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderAt("/");

    expect(await screen.findByText("Stocks is unavailable")).toBeDefined();

    isBroken = false;
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    expect(await screen.findByText("$190.50")).toBeDefined();
    expect(screen.queryByText("Stocks is unavailable")).toBeNull();
    act(() => focusManager.setFocused(undefined));
  });

  it("keeps a card's data when reading it again fails", async () => {
    let isGluetunDown = false;
    const calls = countCalls();

    dashboard({ isGluetunDown: () => isGluetunDown });

    const router = renderAt("/");
    const { queryClient } = router.options.context;

    await screen.findByText("Your VPN is connected!");

    isGluetunDown = true;
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(calls("GET /api/services/gluetun/gluetun-vpn-status-1")).toBe(2));
    await waitFor(() =>
      expect(
        queryClient.getQueryState(getServicesGluetunQueryKey("gluetun-vpn-status-1", { publicIp: true }))?.status,
      ).toBe("error"),
    );

    expect(screen.getByText("Your VPN is connected!")).toBeDefined();
    expect(screen.queryByText("Gluetun is unavailable")).toBeNull();
    act(() => focusManager.setFocused(undefined));
  });

  it("reads Docker's host again as the daemon's changes come", async () => {
    const calls = countCalls();
    const { changes } = dashboard();

    renderAt("/");
    await card("Local");
    await waitFor(() => expect(changes.urls).toHaveLength(1));

    const read = calls("GET /api/docker/overview");

    act(() => changes.send("overview"));

    await waitFor(() => expect(calls("GET /api/docker/overview")).toBeGreaterThan(read));
  });

  it("shows the Docker card again once the daemon's changes say its host changed, after it failed", async () => {
    let isDaemonDown = true;
    // Opened once the page asks for it: the test holds it until the first read of the host failed.
    let openFeed: () => void = () => {};
    const isOpened = new Promise<void>(resolve => (openFeed = resolve));
    const changes = feed<DockerChange>("/api/docker/changes", isOpened);
    const calls = countCalls();

    network.use(
      getWidgetsPlacementsMockHandler(placements.filter(placement => placement.type === "docker-general-stats")),
      // A refusal that is not tried again, so that the test waits for no retry.
      getDockerOverviewMockHandler(() => {
        if (isDaemonDown) {
          throw coded(409, { code: "docker.unavailable", message: "the Docker daemon is not reachable." });
        }

        return overview;
      }),
      getDockerProjectsMockHandler([]),
      changes.handler,
    );

    renderAt("/");

    expect(await screen.findByText("Local is unavailable")).toBeDefined();

    // The feed opens while the daemon is still down: its catch-up read fails again.
    openFeed();
    await waitFor(() => expect(calls("GET /api/docker/overview")).toBe(2));

    isDaemonDown = false;
    act(() => changes.send("overview"));

    expect(await screen.findByText("Docker 29.0.1")).toBeDefined();
    expect(calls("GET /api/docker/overview")).toBe(3);
  });

  it("reads the installed apps of the Docker card along with its host, not after it", async () => {
    const calls = countCalls();

    network.use(
      getWidgetsPlacementsMockHandler(placements.filter(placement => placement.type === "docker-general-stats")),
      // Never answered.
      getDockerOverviewMockHandler(() => new Promise<DockerOverview>(() => {})),
      getDockerProjectsMockHandler([]),
      feed<DockerChange>("/api/docker/changes").handler,
    );

    renderAt("/");

    await waitFor(() => expect(calls("GET /api/docker/overview")).toBe(1));
    await waitFor(() => expect(calls("GET /api/docker/apps")).toBe(1));
  });

  it("reads a widget that failed again when the dashboard is opened again", async () => {
    const calls = countCalls();

    dashboard();
    // What `/settings` reads, on the way.
    network.use(getStoreStatusMockHandler({ url: "u", installed: false, sync: null }), getJobsListMockHandler([]));

    const router = renderAt("/");

    expect(await screen.findByText("Miniflux is unavailable")).toBeDefined();
    expect(calls("GET /api/services/miniflux/miniflux-entries-1")).toBe(1);

    await act(() => router.navigate({ to: "/settings" }));
    await act(() => router.navigate({ to: "/" }));

    expect(await screen.findByText("Miniflux is unavailable")).toBeDefined();
    await waitFor(() => expect(calls("GET /api/services/miniflux/miniflux-entries-1")).toBe(2));
  });

  it("follows no change of the daemon without a Docker card", async () => {
    const calls = countCalls();

    const { changes } = dashboard({
      shown: placements.filter(placement => placement.type !== "docker-general-stats"),
    });

    renderAt("/");

    await card("Frigate");

    expect(changes.urls).toEqual([]);
    expect(calls("GET /api/docker/overview")).toBe(0);
  });
});
