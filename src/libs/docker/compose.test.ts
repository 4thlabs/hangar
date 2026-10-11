import { describe, expect, it } from "vitest";
import { ComposeProjects } from "./compose.ts";
import { containerSource } from "./mock/index.ts";

const { project: PROJECT, service: SERVICE } = ComposeProjects.Label;
/** Shorthand for the shared fixture, which already defaults to one `alpha`/`web` container. */
const container = containerSource;

describe("Compose project aggregation", () => {
  it("groups by canonical labels, ignores one-offs and projects that are no store app, and sorts projects", () => {
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

    expect(new ComposeProjects(containers).summaries(new Set(["alpha", "beta"]), new Set(["alpha", "beta"]))).toEqual([
      {
        name: "alpha",
        status: "partial",
        serviceCount: 2,
        runningCount: 1,
        unhealthyCount: 0,
        containerIds: ["container-1", "alpha-db-1"],
      },
      {
        name: "beta",
        status: "unhealthy",
        serviceCount: 1,
        runningCount: 1,
        unhealthyCount: 1,
        containerIds: ["beta-1"],
      },
    ]);

    expect(
      new ComposeProjects(containers).summaries(new Set(["alpha"]), new Set(["alpha"])).map(summary => summary.name),
    ).toEqual(["alpha"]);
  });

  it("lists an app of the store that is not declared only while it has containers", () => {
    const containers = [container({ Id: "beta-1", labels: { [PROJECT]: "beta", [SERVICE]: "api" } })];
    const known = new Set(["alpha", "beta", "gamma"]);

    // beta runs, so it gets a row; gamma has no container and no category, so it gets none.
    expect(new ComposeProjects(containers).summaries(new Set(["alpha"]), known).map(summary => summary.name)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("lists a declared app that has no container yet as stopped", () => {
    expect(new ComposeProjects([]).summaries(new Set(["gamma"]), new Set(["gamma"]))).toEqual([
      {
        name: "gamma",
        status: "stopped",
        serviceCount: 0,
        runningCount: 0,
        unhealthyCount: 0,
        containerIds: [],
      },
    ]);
  });
});
