import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DockerOverview, WidgetData, WidgetPlacement } from "#libs/api";
import { coded, renderAt, serve } from "#app/mock/page.tsx";

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

/** The server of the dashboard of `placements`, Miniflux's service failing. */
function serveDashboard() {
  return serve({
    "GET /api/widgets": () => Response.json(placements),
    "GET /api/widgets/gluetun-vpn-status-1": () => Response.json(gluetun),
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

  it("shows a widget whose service failed as unavailable, at once, beside the others", async () => {
    const fetch = serveDashboard();

    renderAt("/");

    expect(await screen.findByText("Miniflux is unavailable")).toBeDefined();
    expect(screen.getByText("Its service did not answer. See the server's log.")).toBeDefined();
    expect(fetch.mock.calls.filter(([url]) => url === "/api/widgets/miniflux-entries-1")).toHaveLength(1);
    expect(screen.getByText("Your VPN is connected!")).toBeDefined();
  });
});
