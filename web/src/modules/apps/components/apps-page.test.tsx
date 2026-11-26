import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDetail, ProjectStatus, ProjectSummary } from "#libs/api";
import { events, FakeEventSource, problem, renderAt, serve } from "#app/mock/page.tsx";

/** An installed app with one container, `<name>-1`. */
function project(name: string, status: ProjectStatus, category?: string): ProjectSummary {
  return {
    name,
    icon: null,
    category: category ? { name: category, color: "blue" } : null,
    status,
    serviceCount: 1,
    runningCount: status === "stopped" ? 0 : 1,
    unhealthyCount: status === "unhealthy" ? 1 : 0,
    containerIds: [`${name}-1`],
  };
}

const projects = [
  project("jellyfin", "running", "Media"),
  project("miniflux", "stopped"),
  project("frigate", "unhealthy"),
];

/** The full id of the container of `alpha`. */
const alphaId = "a".repeat(64);

const alpha: ProjectDetail = {
  summary: { ...project("alpha", "running"), containerIds: [alphaId] },
  services: [
    {
      name: "web",
      status: "running",
      runningCount: 1,
      unhealthyCount: 0,
      containers: [
        {
          id: alphaId,
          name: "alpha-web-1",
          service: "web",
          replica: 1,
          image: "nginx:alpine",
          state: "running",
          health: "healthy",
          restartCount: 2,
          ports: [{ ip: "0.0.0.0", privatePort: 80, publicPort: 8080, protocol: "tcp" }],
        },
      ],
    },
  ],
};

/** The names of the apps the table lists, in its order. */
function rows(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map(row => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

/** The source of `url` the page holds open, once it does. */
async function source(url: string): Promise<FakeEventSource> {
  let found: FakeEventSource | undefined;

  await waitFor(() => {
    found = FakeEventSource.of(url);
    expect(found).toBeDefined();
  });

  return found as FakeEventSource;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("/apps", () => {
  it("lists the installed apps by name, with their category and status", async () => {
    serve({ "GET /api/docker/apps": () => Response.json(projects) });
    renderAt("/apps");

    await screen.findByText("jellyfin");

    expect(rows()).toEqual(["frigate", "jellyfin", "miniflux"]);
    expect(screen.getByText("Media")).toBeDefined();
    expect(screen.getByText("Degraded")).toBeDefined();
    expect(screen.getByRole("link", { name: "jellyfin" }).getAttribute("href")).toBe("/apps/jellyfin");
  });

  it("keeps the apps of the statuses of the URL, then narrows them by its query", async () => {
    serve({ "GET /api/docker/apps": () => Response.json(projects) });
    renderAt("/apps?status=running,stopped");

    await screen.findByText("jellyfin");

    expect(rows()).toEqual(["jellyfin", "miniflux"]);

    cleanup();
    serve({ "GET /api/docker/apps": () => Response.json(projects) });
    renderAt("/apps?status=running,stopped&q=mini");

    await screen.findByText("miniflux");

    expect(rows()).toEqual(["miniflux"]);
  });

  it("orders the apps by a column header, then the other way", async () => {
    serve({ "GET /api/docker/apps": () => Response.json(projects) });
    renderAt("/apps");

    await screen.findByText("jellyfin");

    const header = () => within(screen.getAllByRole("row")[0] as HTMLElement).getByRole("button", { name: "Status" });

    fireEvent.click(header());
    await waitFor(() => expect(rows()).toEqual(["jellyfin", "miniflux", "frigate"]));
    fireEvent.click(header());
    await waitFor(() => expect(rows()).toEqual(["frigate", "miniflux", "jellyfin"]));
  });

  it("says why Docker could not be read, once its reads were tried again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve({
      "GET /api/docker/apps": () => problem(503, "the Docker daemon could not be read. See the server's log."),
    });

    renderAt("/apps");
    // The query's three retries, a second, two and four apart.
    await vi.advanceTimersByTimeAsync(8_000);

    expect(await screen.findByText("Could not read the apps")).toBeDefined();
    expect(await screen.findByText("The Docker daemon could not be read. See the server's log.")).toBeDefined();
  });

  it("reads the apps again when the server says their containers changed", async () => {
    let status: ProjectStatus = "running";

    const fetch = serve({ "GET /api/docker/apps": () => Response.json([project("jellyfin", status)]) });

    renderAt("/apps");
    await screen.findByText("Running");

    const changes = await source("/api/docker/changes");

    status = "stopped";
    act(() => changes.send("containers"));

    expect(await screen.findByText("Stopped")).toBeDefined();
    expect(fetch.mock.calls.filter(([url]) => url === "/api/docker/apps")).toHaveLength(2);
  });

  it("reads the apps again each time the changes open, then after a wait once they are lost, saying so meanwhile", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const fetch = serve({ "GET /api/docker/apps": () => Response.json(projects) });
    const reads = () => fetch.mock.calls.filter(([url]) => url === "/api/docker/apps").length;

    renderAt("/apps");
    await screen.findByText("jellyfin");

    const lost = await source("/api/docker/changes");

    act(() => lost.open());

    // A change before the stream opened is not in it.
    await waitFor(() => expect(reads()).toBe(2));

    act(() => lost.fail());

    const notice = "Reconnecting to the server: what this page shows may be out of date.";

    expect(await screen.findByText(notice)).toBeDefined();

    await act(() => vi.advanceTimersByTimeAsync(1_000));

    const back = await source("/api/docker/changes");

    expect(back).not.toBe(lost);

    act(() => back.open());

    await waitFor(() => expect(reads()).toBe(3));
    expect(screen.queryByText(notice)).toBeNull();
  });

  it("clears the live usage while its stream is lost", async () => {
    serve({ "GET /api/docker/apps": () => Response.json(projects) });
    renderAt("/apps");

    const stats = await source("/api/docker/stats");

    act(() => stats.send({ containers: { "jellyfin-1": { cpuPercent: 12.5, memoryUsage: null, memoryLimit: null } } }));
    expect(await screen.findByText("12.5%")).toBeDefined();

    act(() => stats.fail());

    await waitFor(() => expect(screen.queryByText("12.5%")).toBeNull());
  });

  it("totals the live usage of the containers of the installed apps alone", async () => {
    serve({ "GET /api/docker/apps": () => Response.json(projects) });
    renderAt("/apps");

    const stats = await source("/api/docker/stats");
    const metrics = (cpuPercent: number) => ({ cpuPercent, memoryUsage: 1_024, memoryLimit: null });

    act(() => stats.send({ containers: { "jellyfin-1": metrics(10), "frigate-1": metrics(2.5), other: metrics(50) } }));

    expect(await screen.findByText("12.5%")).toBeDefined();
    expect(screen.getByText("2 KiB")).toBeDefined();
  });
});

describe("/apps/:project", () => {
  it("shows the services of the app and their containers", async () => {
    serve({ "GET /api/docker/apps/alpha": () => Response.json(alpha) });
    renderAt("/apps/alpha");

    expect(await screen.findByRole("heading", { name: "alpha" })).toBeDefined();
    expect(screen.getByText("alpha-web-1")).toBeDefined();
    expect(screen.getByText("Healthy")).toBeDefined();
    expect(screen.getByText("0.0.0.0:8080 → 80/tcp")).toBeDefined();
    expect(screen.getByText("1 service · 1/1 containers running")).toBeDefined();
  });

  it("shows the host's memory once for containers with no limit of their own", async () => {
    const host = 16 * 1024 ** 3;

    serve({
      "GET /api/docker/apps/alpha": () => Response.json(alpha),
      "GET /api/docker/overview": () => Response.json({ version: "29.0.1", memory: host }),
    });

    renderAt("/apps/alpha");

    const stats = await source("/api/docker/stats");

    act(() => stats.send({ containers: { [alphaId]: { memoryUsage: 1_024, memoryLimit: host } } }));

    expect(await screen.findByText("16 GiB on the host")).toBeDefined();
  });

  it("shows only why a read again failed, not the app as it was", async () => {
    let isInstalled = true;

    serve({
      "GET /api/docker/apps/alpha": () =>
        isInstalled ? Response.json(alpha) : problem(404, "no app alpha is installed"),
    });

    renderAt("/apps/alpha");
    await screen.findByRole("heading", { name: "alpha" });

    const changes = await source("/api/docker/changes");

    isInstalled = false;
    act(() => changes.send("containers"));

    expect(await screen.findByText("App not found")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "alpha" })).toBeNull();
  });

  it("says an app that is not installed is not found", async () => {
    serve({ "GET /api/docker/apps/beta": () => problem(404, "no app beta is installed") });
    renderAt("/apps/beta");

    expect(await screen.findByText("App not found")).toBeDefined();
    expect(screen.getByRole("link", { name: "Back to apps" })).toBeDefined();
  });

  it("follows the log of a container to its end", async () => {
    const logs = `/api/docker/apps/alpha/containers/${alphaId}/logs`;

    serve({
      "GET /api/docker/apps/alpha": () => Response.json(alpha),
      [`GET ${logs}`]: () =>
        events([
          { kind: "line", line: "2026-11-26T10:00:00Z hello" },
          { kind: "line", line: "2026-11-26T10:00:01Z world" },
          { kind: "end" },
        ]),
    });

    renderAt("/apps/alpha");
    fireEvent.click(await screen.findByRole("button", { name: "View the logs of alpha-web-1" }));

    expect(await screen.findByText("Stream ended")).toBeDefined();
    expect(screen.getByText(/hello\s+2026-11-26T10:00:01Z world/)).toBeDefined();
  });

  it("says why a log could not be followed", async () => {
    serve({
      "GET /api/docker/apps/alpha": () => Response.json(alpha),
      [`GET /api/docker/apps/alpha/containers/${alphaId}/logs`]: () =>
        problem(404, `the app alpha has no container ${alphaId}`),
    });

    renderAt("/apps/alpha");
    fireEvent.click(await screen.findByRole("button", { name: "View the logs of alpha-web-1" }));

    expect(await screen.findByText(`The app alpha has no container ${alphaId}.`)).toBeDefined();
  });
});
