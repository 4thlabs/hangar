import { describe, expect, it, vi } from "vitest";
import type { CommandRunner } from "#libs/hangar";

vi.mock("server-only", () => ({}));

const {
  buildComposeProjectSummaries,
  COMPOSE_CONTAINER_NUMBER_LABEL,
  COMPOSE_ONEOFF_LABEL,
  COMPOSE_PROJECT_LABEL,
  COMPOSE_SERVICE_LABEL,
  DockerNotFoundError,
  getComposeProjectDetail,
} = await import("./projects.ts");

type Overrides = {
  Id?: string;
  Name?: string;
  labels?: Record<string, string>;
  status?: string;
  health?: string;
};

/** A `docker inspect` entry, trimmed to the fields the module reads. */
const container = ({
  Id = "container-1",
  Name = "/alpha-web-1",
  labels,
  status = "running",
  health,
}: Overrides = {}) => ({
  Id,
  Name,
  RestartCount: 2,
  State: { Status: status, ...(health ? { Health: { Status: health } } : {}) },
  Config: {
    Image: "nginx:alpine",
    Labels: labels ?? {
      [COMPOSE_PROJECT_LABEL]: "alpha",
      [COMPOSE_SERVICE_LABEL]: "web",
      [COMPOSE_CONTAINER_NUMBER_LABEL]: "1",
    },
  },
  NetworkSettings: { Ports: { "80/tcp": [{ HostIp: "127.0.0.1", HostPort: "8080" }] } },
});

/**
 * A runner that answers the three `docker` commands this module issues, the way the real
 * runtime would: `ps` with one id per line, `inspect` and `stats` with one JSON doc per line.
 */
const runnerFor = (containers: ReturnType<typeof container>[], stats: unknown[] = []): CommandRunner => ({
  run: vi.fn(async (_command: string, args: string[]) => {
    const lines =
      args[0] === "ps"
        ? containers.map(entry => entry.Id)
        : (args[0] === "stats" ? stats : containers).map(entry => JSON.stringify(entry));

    return { code: 0, stdout: lines.join("\n") };
  }),
});

describe("Docker Compose project aggregation", () => {
  it("groups by canonical labels, ignores one-offs and non-installed projects, and sorts projects", () => {
    const containers = [
      container({
        Id: "beta-1",
        Name: "/beta-api-1",
        labels: { [COMPOSE_PROJECT_LABEL]: "beta", [COMPOSE_SERVICE_LABEL]: "api" },
        health: "unhealthy",
      }),
      container(),
      container({
        Id: "alpha-db-1",
        Name: "/alpha-db-1",
        labels: { [COMPOSE_PROJECT_LABEL]: "alpha", [COMPOSE_SERVICE_LABEL]: "db" },
        status: "exited",
      }),
    ];

    expect(buildComposeProjectSummaries(containers, new Set(["alpha", "beta"]))).toEqual([
      {
        name: "alpha",
        status: "partial",
        serviceCount: 2,
        containerCount: 2,
        runningCount: 1,
        stoppedCount: 1,
        unhealthyCount: 0,
      },
      {
        name: "beta",
        status: "unhealthy",
        serviceCount: 1,
        containerCount: 1,
        runningCount: 1,
        stoppedCount: 0,
        unhealthyCount: 1,
      },
    ]);
    expect(buildComposeProjectSummaries(containers, new Set(["alpha"])).map(project => project.name)).toEqual([
      "alpha",
    ]);
  });

  it("lists an installed app that has no container yet as stopped", () => {
    expect(buildComposeProjectSummaries([], new Set(["gamma"]))).toEqual([
      {
        name: "gamma",
        status: "stopped",
        serviceCount: 0,
        containerCount: 0,
        runningCount: 0,
        stoppedCount: 0,
        unhealthyCount: 0,
      },
    ]);
  });

  it("excludes one-off containers and those without a service label", async () => {
    const runner = runnerFor([
      container(),
      container({
        Id: "alpha-run-1",
        labels: {
          [COMPOSE_PROJECT_LABEL]: "alpha",
          [COMPOSE_SERVICE_LABEL]: "job",
          [COMPOSE_ONEOFF_LABEL]: "True",
        },
      }),
      container({ Id: "no-service", labels: { [COMPOSE_PROJECT_LABEL]: "alpha" } }),
    ]);

    const detail = await getComposeProjectDetail(runner, "alpha", new Set(["alpha"]));

    expect(detail.services.map(service => service.name)).toEqual(["web"]);
    expect(detail.containerCount).toBe(1);
  });

  it("returns an empty detail for an installed app without containers", async () => {
    await expect(getComposeProjectDetail(runnerFor([]), "gamma", new Set(["alpha", "gamma"]))).resolves.toMatchObject({
      name: "gamma",
      status: "stopped",
      services: [],
      partial: false,
    });
  });

  it("rejects a project that is not an installed app", async () => {
    await expect(getComposeProjectDetail(runnerFor([container()]), "alpha", new Set(["beta"]))).rejects.toThrow(
      DockerNotFoundError,
    );
  });

  it("skips the stats sample entirely when metrics are not asked for", async () => {
    const runner = runnerFor([container()]);

    const detail = await getComposeProjectDetail(runner, "alpha", new Set(["alpha"]), false);

    // The page render path must not pay the 1-2s `docker stats` cost.
    const commands = (runner.run as unknown as { mock: { calls: [string, string[]][] } }).mock.calls.map(
      call => call[1][0],
    );
    expect(commands).not.toContain("stats");
    expect(detail.services[0]?.containers[0]).toMatchObject({ metricsAvailable: false });
    // Skipping is deliberate, not a failed sample: no "partial" warning on the page.
    expect(detail.partial).toBe(false);
  });

  it("attaches live metrics to the matching container and publishes its ports", async () => {
    const runner = runnerFor(
      [container({ Id: "abcdef0123456789" })],
      [
        {
          // `docker stats` reports the short id; the full inspect id has to find it.
          ID: "abcdef012345",
          CPUPerc: "10.00%",
          MemUsage: "100MiB / 1GiB",
          MemPerc: "10.00%",
          NetIO: "1kB / 2kB",
          BlockIO: "3kB / 4kB",
        },
      ],
    );

    const detail = await getComposeProjectDetail(runner, "alpha", new Set(["alpha"]));
    const [first] = detail.services[0]?.containers ?? [];

    expect(detail.partial).toBe(false);
    expect(first).toMatchObject({ name: "alpha-web-1", replica: 1, restartCount: 2, metricsAvailable: true });
    expect(first?.metrics.cpuPercent).toBe(10);
    expect(first?.ports).toEqual([{ hostIp: "127.0.0.1", hostPort: 8080, containerPort: 80, protocol: "tcp" }]);
  });

  it("marks the snapshot partial and drops metrics when the stats sample fails", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === "stats") throw new Error("daemon busy");

        return {
          code: 0,
          stdout: args[0] === "ps" ? "container-1" : JSON.stringify(container()),
        };
      }),
    };

    const detail = await getComposeProjectDetail(runner, "alpha", new Set(["alpha"]));

    expect(detail.partial).toBe(true);
    expect(detail.services[0]?.containers[0]).toMatchObject({ metricsAvailable: false });
    expect(detail.services[0]?.containers[0]?.metrics.cpuPercent).toBeNull();
  });
});
