import { focusManager } from "@tanstack/react-query";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWidgetsDataQueryKey, type DockerOverview, type WidgetData, type WidgetPlacement } from "#libs/api";
import { coded, FakeEventSource, renderAt, serve } from "#mock/page.tsx";

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

/** The server of the dashboard of `placements`, Miniflux's service failing, and gluetun's when `isGluetunDown` says. */
function serveDashboard({
  shown = placements,
  isGluetunDown = () => false,
}: { shown?: WidgetPlacement[]; isGluetunDown?: () => boolean } = {}) {
  return serve({
    "GET /api/widgets": () => Response.json(shown),
    "GET /api/widgets/gluetun-vpn-status-1": () =>
      isGluetunDown()
        ? coded(502, "widgets.unavailable", "the gluetun-vpn-status widget could not be loaded.", {
            widget: "gluetun-vpn-status",
          })
        : Response.json(gluetun),
    "GET /api/widgets/frigate-events-1": () => Response.json(frigate),
    "GET /api/widgets/miniflux-entries-1": () =>
      coded(502, "widgets.unavailable", "the miniflux-entries widget could not be loaded. See the server's log.", {
        widget: "miniflux-entries",
      }),
    "GET /api/docker/overview": () => Response.json(overview),
  });
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

/** How many times the page called `url`. */
function calls(fetch: ReturnType<typeof serve>, url: string) {
  return fetch.mock.calls.filter(([called]) => called === url).length;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("/", () => {
  it("places each widget in its column, in the order of hangar.yml", async () => {
    serveDashboard();
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
    serveDashboard();
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

  it("shows Docker's host from the Docker routes", async () => {
    serveDashboard();
    renderAt("/");

    const docker = await card("Local");

    expect(await within(docker).findByText("Docker 29.0.1")).toBeDefined();
    expect(within(docker).getByText("3 unused · 4.2 GB")).toBeDefined();
  });

  it("lists the installed apps the image check found an update for, each linked to its page", async () => {
    const app = (name: string, updateAvailable: boolean) => ({
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

    serve({
      "GET /api/widgets": () => Response.json([placements[1]]),
      "GET /api/docker/overview": () => Response.json(overview),
      "GET /api/docker/apps": () =>
        Response.json([app("miniflux", true), app("frigate", false), app("jellyfin", true)]),
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
    const fetch = serveDashboard();

    renderAt("/");

    expect(await screen.findByText("Miniflux is unavailable")).toBeDefined();
    expect(screen.getByText("Its service did not answer. See the server's log.")).toBeDefined();
    expect(fetch.mock.calls.filter(([url]) => url === "/api/widgets/miniflux-entries-1")).toHaveLength(1);
    expect(screen.getByText("Your VPN is connected!")).toBeDefined();
  });

  it("shows a card that cannot render what its service answered as unavailable, beside the others", async () => {
    serve({
      "GET /api/widgets": () =>
        Response.json([placements[2], { key: "stock-prices-1", type: "stock-prices", column: 3, link: null }]),
      "GET /api/widgets/gluetun-vpn-status-1": () => Response.json(gluetun),
      "GET /api/widgets/stock-prices-1": () => Response.json({ type: "stock-prices", data: {} }),
    });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderAt("/");

    expect(await screen.findByText("Stocks is unavailable")).toBeDefined();
    expect(screen.getByText("The card could not show what its service answered.")).toBeDefined();
    expect(await screen.findByText("Your VPN is connected!")).toBeDefined();
  });

  it("shows a card that threw once again, when its data is read again and renders", async () => {
    let isBroken = true;

    serve({
      "GET /api/widgets": () => Response.json([{ key: "stock-prices-1", type: "stock-prices", column: 3, link: null }]),
      "GET /api/widgets/stock-prices-1": () =>
        Response.json(
          isBroken
            ? { type: "stock-prices", data: {} }
            : {
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
              },
        ),
    });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderAt("/");

    expect(await screen.findByText("Stocks is unavailable")).toBeDefined();

    isBroken = false;
    // A suspense query is fresh for a second after its read: the focus comes back after it.
    vi.setSystemTime(Date.now() + 1_000);
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
    const fetch = serveDashboard({ isGluetunDown: () => isGluetunDown });

    const router = renderAt("/");
    const { queryClient } = router.options.context;

    await screen.findByText("Your VPN is connected!");

    isGluetunDown = true;
    // A suspense query is fresh for a second after its read: the focus comes back after it.
    vi.setSystemTime(Date.now() + 1_000);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(calls(fetch, "/api/widgets/gluetun-vpn-status-1")).toBe(2));
    await waitFor(() =>
      expect(queryClient.getQueryState(getWidgetsDataQueryKey("gluetun-vpn-status-1"))?.status).toBe("error"),
    );

    expect(screen.getByText("Your VPN is connected!")).toBeDefined();
    expect(screen.queryByText("Gluetun is unavailable")).toBeNull();
    act(() => focusManager.setFocused(undefined));
  });

  it("reads Docker's host again as the daemon's changes come", async () => {
    const fetch = serveDashboard();

    renderAt("/");
    await card("Local");

    const changes = await waitFor(() => {
      const source = FakeEventSource.of("/api/docker/changes");

      expect(source).toBeDefined();

      return source as FakeEventSource;
    });

    const read = calls(fetch, "/api/docker/overview");

    act(() => changes.send("overview"));

    await waitFor(() => expect(calls(fetch, "/api/docker/overview")).toBeGreaterThan(read));
  });

  it("shows the Docker card again once the daemon's changes say its host changed, after it failed", async () => {
    let isDaemonDown = true;

    const fetch = serve({
      "GET /api/widgets": () => Response.json([placements[1]]),
      // A refusal that is not tried again, so that the test waits for no retry.
      "GET /api/docker/overview": () =>
        isDaemonDown
          ? coded(409, "docker.unavailable", "the Docker daemon is not reachable.")
          : Response.json(overview),
    });

    renderAt("/");

    expect(await screen.findByText("Local is unavailable")).toBeDefined();

    const changes = await waitFor(() => {
      const source = FakeEventSource.of("/api/docker/changes");

      expect(source).toBeDefined();

      return source as FakeEventSource;
    });

    // The feed opens while the daemon is still down: its catch-up read fails again.
    act(() => changes.open());
    await waitFor(() => expect(calls(fetch, "/api/docker/overview")).toBe(2));

    isDaemonDown = false;
    act(() => changes.send("overview"));

    expect(await screen.findByText("Docker 29.0.1")).toBeDefined();
    expect(calls(fetch, "/api/docker/overview")).toBe(3);
  });

  it("reads the installed apps of the Docker card along with its host, not after it", async () => {
    const fetch = serve({
      "GET /api/widgets": () => Response.json([placements[1]]),
      "GET /api/docker/overview": () => new Promise<Response>(() => {}),
      "GET /api/docker/apps": () => Response.json([]),
    });

    renderAt("/");

    await waitFor(() => expect(calls(fetch, "/api/docker/overview")).toBe(1));
    await waitFor(() => expect(calls(fetch, "/api/docker/apps")).toBe(1));
  });

  it("reads a widget that failed again when the dashboard is opened again", async () => {
    const fetch = serveDashboard();
    const router = renderAt("/");

    expect(await screen.findByText("Miniflux is unavailable")).toBeDefined();
    expect(calls(fetch, "/api/widgets/miniflux-entries-1")).toBe(1);

    await act(() => router.navigate({ to: "/settings" }));
    await act(() => router.navigate({ to: "/" }));

    expect(await screen.findByText("Miniflux is unavailable")).toBeDefined();
    await waitFor(() => expect(calls(fetch, "/api/widgets/miniflux-entries-1")).toBe(2));
  });

  it("follows no change of the daemon without a Docker card", async () => {
    serveDashboard({ shown: placements.filter(placement => placement.type !== "docker-general-stats") });
    renderAt("/");

    await card("Frigate");

    expect(FakeEventSource.sources.map(source => source.url)).not.toContain("/api/docker/changes");
  });
});
