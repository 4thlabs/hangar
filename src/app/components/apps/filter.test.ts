import { describe, expect, it } from "vitest";
import type { ComposeProjectSummary } from "#libs/docker";
import { filterProjects, nextSort, statusCounts } from "./filter.ts";

const project = (name: string, status: ComposeProjectSummary["status"]): ComposeProjectSummary => ({
  name,
  status,
  serviceCount: 1,
  containerCount: 1,
  runningCount: status === "running" ? 1 : 0,
  stoppedCount: status === "running" ? 0 : 1,
  unhealthyCount: status === "unhealthy" ? 1 : 0,
});

const projects = [
  project("nextcloud", "running"),
  project("gitea", "stopped"),
  project("immich", "unhealthy"),
  project("audiobookshelf", "partial"),
];

const names = (result: ComposeProjectSummary[]) => result.map(entry => entry.name);

describe("filterProjects", () => {
  it("shows everything, alphabetically, when nothing is selected", () => {
    expect(names(filterProjects(projects, { q: "", status: [], sort: null }))).toEqual([
      "audiobookshelf",
      "gitea",
      "immich",
      "nextcloud",
    ]);
  });

  it("narrows to one selected status", () => {
    expect(names(filterProjects(projects, { q: "", status: ["running"], sort: null }))).toEqual(["nextcloud"]);
  });

  it("shows the union of several selected statuses", () => {
    const result = filterProjects(projects, { q: "", status: ["unhealthy", "partial"], sort: null });

    expect(names(result)).toEqual(["audiobookshelf", "immich"]);
  });

  it("matches names loosely, and by subsequence", () => {
    expect(names(filterProjects(projects, { q: "next", status: [], sort: null }))).toEqual(["nextcloud"]);
    expect(names(filterProjects(projects, { q: "abs", status: [], sort: null }))).toEqual(["audiobookshelf"]);
  });

  it("applies the status filter before the query", () => {
    // "nextcloud" matches the query but is running, so the stopped-only filter wins.
    expect(filterProjects(projects, { q: "next", status: ["stopped"], sort: null })).toEqual([]);
  });

  it("leaves the caller's array untouched", () => {
    const original = [...projects];
    filterProjects(projects, { q: "", status: [], sort: null });

    expect(projects).toEqual(original);
  });
});

describe("sorting", () => {
  const sorted = (column: Parameters<typeof nextSort>[1], descending: boolean) =>
    names(filterProjects(projects, { q: "", status: [], sort: { column, descending } }));

  it("sorts by name in both directions", () => {
    expect(sorted("name", false)).toEqual(["audiobookshelf", "gitea", "immich", "nextcloud"]);
    expect(sorted("name", true)).toEqual(["nextcloud", "immich", "gitea", "audiobookshelf"]);
  });

  it("sorts status by severity, not alphabetically", () => {
    // running < partial < stopped < unhealthy, so descending puts the broken ones on top.
    expect(sorted("status", true)).toEqual(["immich", "gitea", "audiobookshelf", "nextcloud"]);
  });

  it("sorts counts numerically", () => {
    const wide = [
      { ...project("a", "running"), containerCount: 9 },
      { ...project("b", "running"), containerCount: 10 },
    ];
    const result = filterProjects(wide, { q: "", status: [], sort: { column: "containers", descending: true } });

    // A string compare would put "9" after "10".
    expect(names(result)).toEqual(["b", "a"]);
  });

  it("breaks ties on the name so the order survives a refresh", () => {
    // Every project here has one service, so the tie-break is the only thing ordering them.
    expect(sorted("services", false)).toEqual(["audiobookshelf", "gitea", "immich", "nextcloud"]);
    expect(sorted("services", true)).toEqual(["audiobookshelf", "gitea", "immich", "nextcloud"]);
  });

  it("overrides search relevance when a column is chosen", () => {
    const relevance = names(filterProjects(projects, { q: "i", status: [], sort: null }));
    const byName = names(filterProjects(projects, { q: "i", status: [], sort: { column: "name", descending: true } }));

    expect(byName).toEqual([...relevance].sort((left, right) => right.localeCompare(left)));
  });
});

describe("nextSort", () => {
  it("cycles a column through ascending, descending, then off", () => {
    const ascending = nextSort(null, "name");
    expect(ascending).toEqual({ column: "name", descending: false });

    const descending = nextSort(ascending, "name");
    expect(descending).toEqual({ column: "name", descending: true });

    // Back to null: there has to be a way back to relevance ordering while searching.
    expect(nextSort(descending, "name")).toBeNull();
  });

  it("starts a different column ascending", () => {
    expect(nextSort({ column: "name", descending: true }, "status")).toEqual({
      column: "status",
      descending: false,
    });
  });
});

describe("statusCounts", () => {
  it("counts each status, and reports nothing for absent ones", () => {
    const counts = statusCounts([...projects, project("paperless", "running")]);

    expect(counts).toEqual({ running: 2, stopped: 1, unhealthy: 1, partial: 1 });
  });
});
