import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./client.ts", async () => ({ docker: (await import("./docker-mock.ts")).docker }));

const { containerSource, dockerMock, givenContainers } = await import("./docker-mock.ts");

const {
  buildComposeProjectSummaries,
  COMPOSE_CONTAINER_NUMBER_LABEL,
  COMPOSE_ONEOFF_LABEL,
  COMPOSE_PROJECT_LABEL,
  COMPOSE_SERVICE_LABEL,
  DockerNotFoundError,
  getComposeProjectDetail,
} = await import("./projects.ts");
/** Shorthand for the shared fixture, which already defaults to one `alpha`/`web` container. */
const container = containerSource;

beforeEach(() => vi.clearAllMocks());

describe("Docker Compose project aggregation", () => {
  it("groups by canonical labels, ignores one-offs and non-installed projects, and sorts projects", () => {
    const containers = [
      container({
        Id: "beta-1",
        name: "/beta-api-1",
        labels: { [COMPOSE_PROJECT_LABEL]: "beta", [COMPOSE_SERVICE_LABEL]: "api" },
        health: "unhealthy",
      }),
      container(),
      container({
        Id: "alpha-db-1",
        name: "/alpha-db-1",
        labels: { [COMPOSE_PROJECT_LABEL]: "alpha", [COMPOSE_SERVICE_LABEL]: "db" },
        state: "exited",
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
        containerIds: ["container-1", "alpha-db-1"],
      },
      {
        name: "beta",
        status: "unhealthy",
        serviceCount: 1,
        containerCount: 1,
        runningCount: 1,
        stoppedCount: 0,
        unhealthyCount: 1,
        containerIds: ["beta-1"],
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
        containerIds: [],
      },
    ]);
  });

  it("excludes one-off containers and those without a service label", async () => {
    givenContainers([
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

    const detail = await getComposeProjectDetail("alpha", new Set(["alpha"]));

    expect(detail.services.map(service => service.name)).toEqual(["web"]);
    expect(detail.containerCount).toBe(1);
  });

  it("returns an empty detail for an installed app without containers", async () => {
    await expect(getComposeProjectDetail("gamma", new Set(["alpha", "gamma"]))).resolves.toMatchObject({
      name: "gamma",
      status: "stopped",
      services: [],
      containerIds: [],
    });
  });

  it("rejects a project that is not an installed app", async () => {
    givenContainers([container()]);

    await expect(getComposeProjectDetail("alpha", new Set(["beta"]))).rejects.toThrow(DockerNotFoundError);
  });

  it("never samples statistics: the topology must not wait on a CPU delta", async () => {
    givenContainers([container()]);

    const detail = await getComposeProjectDetail("alpha", new Set(["alpha"]));

    expect(dockerMock.stats).not.toHaveBeenCalled();
    // The ids are what lets the client pick this app's rows out of the shared stats stream.
    expect(detail.containerIds).toEqual(["container-1"]);
  });

  it("describes the container and keeps only host-published ports", async () => {
    givenContainers([
      container({
        Id: "abcdef0123456789",
        ports: [
          // Exposed but not published: nothing to show the user, and no host port to sort on.
          { IP: "", PrivatePort: 9000, PublicPort: 0, Type: "tcp" },
          { IP: "127.0.0.1", PrivatePort: 80, PublicPort: 8080, Type: "tcp" },
        ],
      }),
    ]);

    const detail = await getComposeProjectDetail("alpha", new Set(["alpha"]));
    const [first] = detail.services[0]?.containers ?? [];

    expect(first).toMatchObject({ name: "alpha-web-1", replica: 1, restartCount: 2 });
    expect(first?.ports).toEqual([{ IP: "127.0.0.1", PrivatePort: 80, PublicPort: 8080, Type: "tcp" }]);
  });
});
