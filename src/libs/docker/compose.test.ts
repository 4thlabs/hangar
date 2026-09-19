import { describe, expect, it } from "vitest";
import { ComposeProjects } from "./compose.ts";
import { containerSource } from "./mock/index.ts";

const { project: PROJECT, service: SERVICE } = ComposeProjects.LABEL;
/** Shorthand for the shared fixture, which already defaults to one `alpha`/`web` container. */
const container = containerSource;

describe("Compose project aggregation", () => {
  it("groups by canonical labels, ignores one-offs and non-installed projects, and sorts projects", () => {
    const containers = [
      container({
        Id: "beta-1",
        name: "/beta-api-1",
        labels: { [PROJECT]: "beta", [SERVICE]: "api" },
        health: "unhealthy",
      }),
      container(),
      container({
        Id: "alpha-db-1",
        name: "/alpha-db-1",
        labels: { [PROJECT]: "alpha", [SERVICE]: "db" },
        state: "exited",
      }),
    ];

    expect(new ComposeProjects(containers).summaries(new Set(["alpha", "beta"]))).toEqual([
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
    expect(new ComposeProjects(containers).summaries(new Set(["alpha"])).map(summary => summary.name)).toEqual([
      "alpha",
    ]);
  });

  it("lists an installed app that has no container yet as stopped", () => {
    expect(new ComposeProjects([]).summaries(new Set(["gamma"]))).toEqual([
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
});
