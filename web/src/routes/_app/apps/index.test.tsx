import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ComposeAction,
  ComposeBatch,
  ComposeEvent,
  ComposeReport,
  ComposeRequest,
  ContainerMetrics,
  DockerChange,
  DockerOverview,
  LogEvent,
  ProjectDetail,
  ProjectStatus,
  ProjectSummary,
  StatsFrame,
} from "#libs/api";
import {
  getComposeBatchesMockHandler,
  getComposeOutputMockHandler,
  getComposeRunMockHandler,
  getDockerLogsMockHandler,
  getDockerOverviewMockHandler,
  getDockerProjectMockHandler,
  getDockerProjectsMockHandler,
} from "#libs/api/mock";
import { coded, countCalls, events, feed, network, problem } from "#mock/network.ts";
import { FakeEventSource, renderAt, stubEventSource } from "#mock/page.tsx";
import { composeCommandLine } from "#modules/common/helpers/compose-actions.ts";

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
    updateAvailable: false,
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

/** A container's usage: nothing measured but what `measured` says. */
function usage(measured: Partial<ContainerMetrics>): ContainerMetrics {
  return {
    blockRead: null,
    blockWrite: null,
    cpuPercent: null,
    memoryLimit: null,
    memoryPercent: null,
    memoryUsage: null,
    networkRx: null,
    networkTx: null,
    ...measured,
  };
}

/** The names of the apps the table lists, in its order. */
function rows(): string[] {
  return (
    screen
      .getAllByRole("row")
      .slice(1)
      // The first cell is the row's checkbox.
      .map(row => within(row).getAllByRole("cell")[1]?.textContent ?? "")
  );
}

/** Docker's host, with 16 GiB of memory. */
const host: DockerOverview = {
  version: "29.0.1",
  memory: 16 * 1024 ** 3,
  containers: { total: 4, running: 3, stopped: 1 },
  images: { total: 4, unused: 0, size: 0 },
  volumes: { total: 0, inUse: 0, unused: 0 },
};

/**
 * What the apps' pages call: `projects` as the apps, `alpha` as the page of any of them, Docker's host, no compose
 * batch, and the Docker changes, opened once `changesOpened` resolves, and the containers' usage: two feeds the test
 * sends on. A test's own handlers, added after, win.
 */
function appsPages({ changesOpened }: { changesOpened?: Promise<void> } = {}) {
  const changes = feed<DockerChange>("/api/docker/changes", changesOpened);
  const stats = feed<StatsFrame>("/api/docker/stats");

  network.use(
    getDockerProjectsMockHandler(projects),
    getDockerProjectMockHandler(alpha),
    getDockerOverviewMockHandler(host),
    getComposeBatchesMockHandler([]),
    changes.handler,
    stats.handler,
  );

  return { changes, stats };
}

/** The source of `url` the page holds open, once it does, in a test that drives a lost stream. */
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
    appsPages();
    renderAt("/apps");

    await screen.findByText("jellyfin");

    expect(rows()).toEqual(["frigate", "jellyfin", "miniflux"]);
    expect(screen.getByText("Media")).toBeDefined();
    expect(screen.getByText("Degraded")).toBeDefined();
    expect(screen.getByRole("link", { name: "jellyfin" }).getAttribute("href")).toBe("/apps/jellyfin");
  });

  it("keeps the apps of the statuses of the URL, then narrows them by its query", async () => {
    appsPages();
    renderAt("/apps?status=running,stopped");

    await screen.findByText("jellyfin");

    expect(rows()).toEqual(["jellyfin", "miniflux"]);

    cleanup();
    renderAt("/apps?status=running,stopped&q=mini");

    await screen.findByText("miniflux");

    expect(rows()).toEqual(["miniflux"]);
  });

  it("badges the apps the last image check found an update for, and keeps them by the update filter", async () => {
    const outdated = [...projects.slice(0, 2), { ...project("frigate", "unhealthy"), updateAvailable: true }];

    appsPages();
    network.use(getDockerProjectsMockHandler(outdated));
    renderAt("/apps?update=available");

    await screen.findByText("frigate");

    expect(rows()).toEqual(["frigateUpdate"]);

    cleanup();
    renderAt("/apps?update=current");

    await screen.findByText("jellyfin");

    expect(rows()).toEqual(["jellyfin", "miniflux"]);
    expect(within(screen.getByRole("table")).queryByText("Update")).toBeNull();
  });

  it("orders the apps by a column header, then the other way", async () => {
    appsPages();
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
    appsPages();
    network.use(
      getDockerProjectsMockHandler(() => {
        throw problem(503, "the Docker daemon could not be read. See the server's log.");
      }),
    );

    renderAt("/apps");
    // The query's three retries, a second, two and four apart.
    await vi.advanceTimersByTimeAsync(8_000);

    expect(await screen.findByText("Could not read the apps")).toBeDefined();
    expect(await screen.findByText("The Docker daemon could not be read. See the server's log.")).toBeDefined();
  });

  it("reads the apps again when the server says their containers changed", async () => {
    let status: ProjectStatus = "running";
    let openChanges: () => void = () => {};
    const calls = countCalls();
    const { changes } = appsPages({ changesOpened: new Promise(resolve => (openChanges = resolve)) });

    network.use(getDockerProjectsMockHandler(() => [project("jellyfin", status)]));
    renderAt("/apps");
    await screen.findByText("Running");
    // The changes open once the apps are read: what they missed is read again.
    openChanges();
    await waitFor(() => expect(calls("GET /api/docker/apps")).toBe(2));

    status = "stopped";
    act(() => changes.send("containers"));

    expect(await screen.findByText("Stopped")).toBeDefined();
    expect(calls("GET /api/docker/apps")).toBe(3);
  });

  it("reads the apps again each time the changes open, then after a wait once they are lost, saying so meanwhile", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // A stream lost, then connected again: the fake `EventSource`, which the test opens and fails.
    stubEventSource();
    appsPages();

    const calls = countCalls();
    const reads = () => calls("GET /api/docker/apps");

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
    // A stream lost: the fake `EventSource`, which the test fails.
    stubEventSource();
    appsPages();
    renderAt("/apps");

    const stats = await source("/api/docker/stats");

    act(() => stats.send({ containers: { "jellyfin-1": usage({ cpuPercent: 12.5 }) } }));
    expect(await screen.findByText("12.5%")).toBeDefined();

    act(() => stats.fail());

    await waitFor(() => expect(screen.queryByText("12.5%")).toBeNull());
  });

  it("totals the live usage of the containers of the installed apps alone", async () => {
    const { stats } = appsPages();

    renderAt("/apps");
    await waitFor(() => expect(stats.urls).toHaveLength(1));

    const metrics = (cpuPercent: number) => usage({ cpuPercent, memoryUsage: 1_024 });

    act(() => stats.send({ containers: { "jellyfin-1": metrics(10), "frigate-1": metrics(2.5), other: metrics(50) } }));

    expect(await screen.findByText("12.5%")).toBeDefined();
    expect(screen.getByText("2 KiB")).toBeDefined();
  });
});

describe("/apps/:project", () => {
  it("shows the services of the app and their containers", async () => {
    appsPages();
    renderAt("/apps/alpha");

    expect(await screen.findByRole("heading", { name: "alpha" })).toBeDefined();
    expect(screen.getByText("alpha-web-1")).toBeDefined();
    expect(screen.getByText("Healthy")).toBeDefined();
    expect(screen.getByText("0.0.0.0:8080 → 80/tcp")).toBeDefined();
    expect(screen.getByText("1 service · 1/1 container running")).toBeDefined();
    expect(screen.queryByText("Update available")).toBeNull();
  });

  it("badges an app the last image check found an update for", async () => {
    const outdated = { ...alpha, summary: { ...alpha.summary, updateAvailable: true } };

    appsPages();
    network.use(getDockerProjectMockHandler(outdated));
    renderAt("/apps/alpha");

    expect(await screen.findByText("Update available")).toBeDefined();
  });

  it("shows the host's memory once for containers with no limit of their own", async () => {
    const { stats } = appsPages();

    renderAt("/apps/alpha");
    await waitFor(() => expect(stats.urls).toHaveLength(1));

    act(() => stats.send({ containers: { [alphaId]: usage({ memoryUsage: 1_024, memoryLimit: host.memory }) } }));

    expect(await screen.findByText("16 GiB on the host")).toBeDefined();
  });

  it("shows only why a read again failed, not the app as it was", async () => {
    let isInstalled = true;
    const { changes } = appsPages();

    network.use(
      getDockerProjectMockHandler(() => {
        if (!isInstalled) {
          throw problem(404, "no app alpha is installed");
        }

        return alpha;
      }),
    );

    renderAt("/apps/alpha");
    await screen.findByRole("heading", { name: "alpha" });
    await waitFor(() => expect(changes.urls).toHaveLength(1));

    isInstalled = false;
    act(() => changes.send("containers"));

    expect(await screen.findByText("App not found")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "alpha" })).toBeNull();
  });

  it("says an app that is not installed is not found", async () => {
    appsPages();
    network.use(
      getDockerProjectMockHandler(() => {
        throw problem(404, "no app beta is installed");
      }),
    );

    renderAt("/apps/beta");

    expect(await screen.findByText("App not found")).toBeDefined();
    expect(screen.getByRole("link", { name: "Back to apps" })).toBeDefined();
  });

  it("follows the log of a container to its end", async () => {
    const container: string[] = [];

    appsPages();
    network.use(
      getDockerLogsMockHandler(({ params }) => {
        container.push(params.container);

        return events<LogEvent>([
          { kind: "line", line: "2026-11-26T10:00:00Z hello" },
          { kind: "line", line: "2026-11-26T10:00:01Z world" },
          { kind: "end" },
        ]);
      }),
    );

    renderAt("/apps/alpha");
    fireEvent.click(await screen.findByRole("button", { name: "View the logs of alpha-web-1" }));

    expect(await screen.findByText("Stream ended")).toBeDefined();
    expect(screen.getByText(/hello\s+2026-11-26T10:00:01Z world/)).toBeDefined();
    expect(container).toEqual([alphaId]);
  });

  it("reads the log again from its tail on Reconnect, without the lines of the last read", async () => {
    const reads: LogEvent[][] = [
      [{ kind: "line", line: "2026-11-26T10:00:00Z first read" }, { kind: "end" }],
      [{ kind: "line", line: "2026-11-26T10:05:00Z second read" }, { kind: "end" }],
    ];

    appsPages();
    network.use(getDockerLogsMockHandler(() => events(reads.shift() ?? [])));

    renderAt("/apps/alpha");
    fireEvent.click(await screen.findByRole("button", { name: "View the logs of alpha-web-1" }));
    expect(await screen.findByText(/first read/)).toBeDefined();

    fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));

    expect(await screen.findByText(/second read/)).toBeDefined();
    expect(screen.queryByText(/first read/)).toBeNull();
  });

  it("says why a log could not be followed", async () => {
    appsPages();
    network.use(
      getDockerLogsMockHandler(() => {
        throw problem(404, `the app alpha has no container ${alphaId}`);
      }),
    );

    renderAt("/apps/alpha");
    fireEvent.click(await screen.findByRole("button", { name: "View the logs of alpha-web-1" }));

    expect(await screen.findByText(`The app alpha has no container ${alphaId}.`)).toBeDefined();
  });
});

describe("compose commands", () => {
  /** The batch of `action` over `apps`, in the order they run, as the server lists it and as its output starts. */
  function batch(id: number, action: ComposeAction, apps: string[], report: ComposeReport | null = null): ComposeBatch {
    return {
      id,
      action,
      commandLine: composeCommandLine(action),
      apps,
      startedAt: "2026-11-26T10:00:00.000Z",
      report,
    };
  }

  const plainUp: ComposeAction = { operation: "up", pull: false, forceRecreate: false };

  /** A batch's events on `app`: its start, a line, and its end. */
  function ran(app: string): ComposeEvent[] {
    const outcome = { app, status: "succeeded", error: null } as const;

    return [
      { kind: "started", app },
      { kind: "line", app, line: ` Container ${app}-web-1  Started` },
      { kind: "finished", ...outcome },
    ];
  }

  it("runs Up on the apps selected, and shows each one's output and outcome", async () => {
    const posted: ComposeRequest[] = [];

    appsPages();
    network.use(
      getComposeRunMockHandler(async ({ request }) => {
        posted.push(await request.json());

        return events<ComposeEvent>([
          // `hangar.yml` lists miniflux first.
          { kind: "batch", ...batch(1, plainUp, ["miniflux", "jellyfin"]) },
          ...ran("miniflux"),
          ...ran("jellyfin"),
          {
            kind: "end",
            apps: [
              { app: "miniflux", status: "succeeded", error: null },
              { app: "jellyfin", status: "succeeded", error: null },
            ],
          },
        ]);
      }),
    );

    renderAt("/apps");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select miniflux" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select jellyfin" }));
    expect(screen.getByText("2 apps selected")).toBeDefined();

    // A plain up only adds what is missing: it asks for no confirmation.
    fireEvent.click(screen.getByRole("button", { name: "Up: docker compose up -d" }));

    expect(await screen.findByText("Done")).toBeDefined();

    expect(posted).toEqual([
      { action: { operation: "up", pull: false, forceRecreate: false }, apps: ["jellyfin", "miniflux"] },
    ]);

    // Laid out in the order the batch runs them, not the table's.
    const panel = within(screen.getByRole("dialog"));

    expect(panel.getAllByRole("region").map(region => region.getAttribute("aria-label"))).toEqual([
      "miniflux",
      "jellyfin",
    ]);

    const miniflux = screen.getByRole("region", { name: "miniflux" });

    expect(within(miniflux).getByText("Succeeded")).toBeDefined();
    expect(
      within(miniflux).getByText(" Container miniflux-web-1  Started", { normalizer: text => text }),
    ).toBeDefined();
  });

  it("asks before taking an app down, and says why the command failed on it", async () => {
    const error = {
      code: "compose.failed",
      params: { app: "alpha", command: "docker compose down" },
      message: "docker compose down failed on alpha. See the server's log.",
    } as const;

    const calls = countCalls();

    appsPages();
    network.use(
      getComposeRunMockHandler(() =>
        events<ComposeEvent>([
          { kind: "batch", ...batch(1, { operation: "down" }, ["alpha"]) },
          { kind: "started", app: "alpha" },
          { kind: "line", app: "alpha", line: "alpha: no such network" },
          { kind: "finished", app: "alpha", status: "failed", error },
          { kind: "end", apps: [{ app: "alpha", status: "failed", error }] },
        ]),
      ),
    );

    renderAt("/apps/alpha");
    fireEvent.click(await screen.findByRole("button", { name: "Down" }));

    expect(await screen.findByText("Stop alpha?")).toBeDefined();
    expect(calls("POST /api/docker/compose")).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("docker compose down failed on alpha. See the server's log.")).toBeDefined();
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("alpha: no such network")).toBeDefined();
  });

  it("says why a batch was refused", async () => {
    appsPages();
    network.use(
      getComposeRunMockHandler(() => {
        throw coded(404, {
          code: "docker.unknown_project",
          params: { project: "alpha" },
          message: "no app alpha is installed",
        });
      }),
    );

    renderAt("/apps/alpha");
    fireEvent.click(await screen.findByRole("button", { name: "Up: docker compose up -d" }));

    expect(await screen.findByText("No app alpha is installed.")).toBeDefined();
  });

  it("finds a batch that runs again, and shows its output from its start", async () => {
    appsPages();
    network.use(
      getComposeBatchesMockHandler([batch(4, { operation: "restart" }, ["alpha", "beta"])]),
      getComposeOutputMockHandler(({ params }) =>
        params.id === "4"
          ? events<ComposeEvent>([
              { kind: "batch", ...batch(4, { operation: "restart" }, ["alpha", "beta"]) },
              ...ran("alpha"),
              { kind: "started", app: "beta" },
            ])
          : events([]),
      ),
    );

    renderAt("/apps/alpha");

    expect(await screen.findByText(/Restart runs on 2 apps/)).toBeDefined();
    // Another command holds the app: none of its buttons runs one.
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Restart" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Up: docker compose up -d" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Show output" }));

    const beta = await screen.findByRole("region", { name: "beta" });

    expect(within(beta).getByText("Running")).toBeDefined();
    expect(within(screen.getByRole("region", { name: "alpha" })).getByText("Succeeded")).toBeDefined();
    // Cut before its end: the batch goes on, which the panel says.
    expect(await screen.findByText("The output was cut short: the command goes on on the server.")).toBeDefined();
  });

  it("names Up's confirmation after the options ticked in its menu", async () => {
    appsPages();
    renderAt("/apps/alpha");

    /** Ticks or unticks `option` in Up's menu, asks for Up, and gives the confirmation's title, closing it. */
    async function confirmationWith(option: RegExp): Promise<string | null> {
      fireEvent.click(await screen.findByRole("button", { name: "Up options" }));
      fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: option }));
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      fireEvent.click(await screen.findByRole("button", { name: /^Up: docker compose up -d / }));

      const title = (await screen.findByRole("alertdialog")).querySelector("h2")?.textContent ?? null;

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

      return title;
    }

    expect(await confirmationWith(/Update the images/)).toBe("Update alpha?");
    expect(await confirmationWith(/Force recreation/)).toBe("Update and recreate alpha?");
    expect(await confirmationWith(/Update the images/)).toBe("Recreate alpha?");
  });

  it("closes a confirmation whose selection was emptied", async () => {
    let listed = projects;
    const { changes } = appsPages();

    network.use(getDockerProjectsMockHandler(() => listed));
    renderAt("/apps");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select miniflux" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));

    expect(await screen.findByText("Restart miniflux?")).toBeDefined();

    // Uninstalled meanwhile: the apps read again drop it from the selection.
    await waitFor(() => expect(changes.urls).toHaveLength(1));
    listed = projects.filter(project => project.name !== "miniflux");
    act(() => changes.send("containers"));

    await waitFor(() => expect(screen.queryByText("Restart miniflux?")).toBeNull());
  });

  it("keeps the panel of an app's page while a read again of the app fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let isReadable = true;
    const { changes } = appsPages();

    network.use(
      getDockerProjectMockHandler(() => {
        if (!isReadable) {
          throw problem(500, "the daemon went away");
        }

        return alpha;
      }),
      getComposeBatchesMockHandler([batch(4, { operation: "restart" }, ["alpha"])]),
      getComposeOutputMockHandler(
        events<ComposeEvent>([
          { kind: "batch", ...batch(4, { operation: "restart" }, ["alpha"]) },
          { kind: "started", app: "alpha" },
        ]),
      ),
    );

    renderAt("/apps/alpha");
    fireEvent.click(await screen.findByRole("button", { name: "Show output" }));
    expect(await screen.findByRole("region", { name: "alpha" })).toBeDefined();
    await waitFor(() => expect(changes.urls).toHaveLength(1));

    isReadable = false;
    act(() => changes.send("containers"));
    // The query's three retries, a second, two and four apart.
    await act(() => vi.advanceTimersByTimeAsync(8_000));

    expect(await screen.findByText("Could not read this app")).toBeDefined();
    expect(screen.getByRole("region", { name: "alpha" })).toBeDefined();
  });

  it("lists a batch another page started once the server says the containers changed", async () => {
    let listed: ComposeBatch[] = [];
    const { changes } = appsPages();

    network.use(getComposeBatchesMockHandler(() => listed));
    renderAt("/apps/alpha");
    await screen.findByRole("heading", { name: "alpha" });
    await waitFor(() => expect(changes.urls).toHaveLength(1));

    listed = [batch(5, plainUp, ["alpha"])];
    act(() => changes.send("containers"));

    expect(await screen.findByText(/Up runs on alpha/)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Down" }).disabled).toBe(true);
  });

  it("keeps the panel when the apps read again leave no row to the filter", async () => {
    let status: ProjectStatus = "running";
    const { changes } = appsPages();

    network.use(
      getDockerProjectsMockHandler(() => [project("jellyfin", status)]),
      getComposeRunMockHandler(() =>
        events<ComposeEvent>([
          { kind: "batch", ...batch(1, { operation: "down" }, ["jellyfin"]) },
          { kind: "started", app: "jellyfin" },
        ]),
      ),
    );

    renderAt("/apps?status=running");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select jellyfin" }));
    fireEvent.click(screen.getByRole("button", { name: "Down" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("region", { name: "jellyfin" })).toBeDefined();
    await waitFor(() => expect(changes.urls).toHaveLength(1));

    status = "stopped";
    act(() => changes.send("containers"));

    expect(await screen.findByText("No results")).toBeDefined();
    expect(screen.getByRole("region", { name: "jellyfin" })).toBeDefined();
  });
});
