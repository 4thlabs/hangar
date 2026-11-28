import { focusManager } from "@tanstack/react-query";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getWidgetsDataQueryKey,
  type DockerChange,
  type DockerOverview,
  type JellyfinItem,
  type ProjectSummary,
  type WidgetData,
  type WidgetPlacement,
} from "#libs/api";
import {
  getDockerOverviewMockHandler,
  getDockerProjectsMockHandler,
  getJobsListMockHandler,
  getServicesJellyfinMockHandler,
  getStoreStatusMockHandler,
  getWidgetsDataMockHandler,
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

const gluetun: WidgetData = {
  type: "gluetun-vpn-status",
  data: { publicIp: "203.0.113.7", city: "Amsterdam", country: "Netherlands" },
};

const frigate: WidgetData = {
  type: "frigate-events",
  data: {
    cameraCount: 2,
    detectionFps: 4.25,
    detectors: [{ name: "coral", inferenceSpeed: 8.5 }],
    events: [
      {
        id: "1700000000.5-abc",
        camera: "frigate_front_door",
        label: "person",
        subLabel: "Ana",
        startTime: "2023-11-14T22:13:20.500Z",
      },
    ],
  },
};

const overview: DockerOverview = {
  version: "29.0.1",
  memory: 16_000_000_000,
  containers: { total: 12, running: 10, stopped: 2 },
  images: { total: 20, unused: 3, size: 4_509_715_660 },
  volumes: { total: 8, inUse: 6, unused: 2 },
};

/**
 * The stocks' data: Apple's, or, when `isBroken`, a body with no stocks, which the contract refuses and the card cannot
 * render.
 */
function stocks({ isBroken }: { isBroken: boolean }): WidgetData {
  if (isBroken) {
    // Cast: the contract refuses this body, which a server newer or older than the page may send, and the card must
    // fail on it alone.
    return { type: "stock-prices", data: {} } as WidgetData;
  }

  return {
    type: "stock-prices",
    data: {
      stocks: [
        {
          symbol: "AAPL",
          name: "Apple Inc",
          currency: "USD",
          price: 190.5,
          changePercent: 1.06,
          high: 191,
          low: 187,
          open: 188,
          closes: [],
        },
      ],
    },
  };
}

/** The widgets' data, by key: Miniflux's service failing, and gluetun's when `isGluetunDown` says. */
function widgetData(key: string, isGluetunDown: boolean): WidgetData {
  switch (key) {
    case "gluetun-vpn-status-1":
      if (isGluetunDown) {
        throw coded(502, {
          code: "widgets.unavailable",
          params: { widget: "gluetun-vpn-status" },
          message: "the gluetun-vpn-status widget could not be loaded.",
        });
      }

      return gluetun;
    case "frigate-events-1":
      return frigate;
    case "miniflux-entries-1":
      throw coded(502, {
        code: "widgets.unavailable",
        params: { widget: "miniflux-entries" },
        message: "the miniflux-entries widget could not be loaded. See the server's log.",
      });
    default:
      throw new Error(`no data for the widget ${key}`);
  }
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
    getWidgetsDataMockHandler(({ params }) => widgetData(params.key, isGluetunDown())),
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
      "/api/widgets/frigate-events-1/image/1700000000.5-abc",
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
    expect(calls("GET /api/widgets/miniflux-entries-1")).toBe(1);
    expect(screen.getByText("Your VPN is connected!")).toBeDefined();
  });

  it("shows a card that cannot render what its service answered as unavailable, beside the others", async () => {
    network.use(
      getWidgetsPlacementsMockHandler([
        { key: "gluetun-vpn-status-1", type: "gluetun-vpn-status", column: 2, link: null },
        { key: "stock-prices-1", type: "stock-prices", column: 3, link: null },
      ]),
      // A body with no stocks, which the contract refuses: the card cannot render it.
      getWidgetsDataMockHandler(({ params }) =>
        params.key === "stock-prices-1" ? stocks({ isBroken: true }) : widgetData(params.key, false),
      ),
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
      getWidgetsDataMockHandler(() => stocks({ isBroken })),
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

    await waitFor(() => expect(calls("GET /api/widgets/gluetun-vpn-status-1")).toBe(2));
    await waitFor(() =>
      expect(queryClient.getQueryState(getWidgetsDataQueryKey("gluetun-vpn-status-1"))?.status).toBe("error"),
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
    expect(calls("GET /api/widgets/miniflux-entries-1")).toBe(1);

    await act(() => router.navigate({ to: "/settings" }));
    await act(() => router.navigate({ to: "/" }));

    expect(await screen.findByText("Miniflux is unavailable")).toBeDefined();
    await waitFor(() => expect(calls("GET /api/widgets/miniflux-entries-1")).toBe(2));
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
