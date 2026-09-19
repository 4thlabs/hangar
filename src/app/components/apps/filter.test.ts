import { describe, expect, it } from "vitest";
import type { ComposeProjectSummary } from "#libs/docker";
import { countBy, filterProjects, nextSort } from "./filter.ts";

const project = (name: string, status: ComposeProjectSummary["status"], category?: string): ComposeProjectSummary => ({
  name,
  status,
  ...(category ? { category: { name: category, color: "blue" } } : {}),
  serviceCount: 1,
  containerCount: 1,
  runningCount: status === "running" ? 1 : 0,
  stoppedCount: status === "running" ? 0 : 1,
  unhealthyCount: status === "unhealthy" ? 1 : 0,
  containerIds: [`${name}-1`],
});

const projects = [
  project("nextcloud", "running"),
  project("gitea", "stopped"),
  project("immich", "unhealthy"),
  project("audiobookshelf", "partial"),
];

/** The same four apps, but classified: `gitea` is deliberately left out of every category. */
const classified = [
  project("nextcloud", "running", "media"),
  project("gitea", "stopped"),
  project("immich", "unhealthy", "media"),
  project("audiobookshelf", "partial", "infra"),
];

const names = (result: ComposeProjectSummary[]) => result.map(entry => entry.name);

describe("filterProjects", () => {
  it("shows everything, alphabetically, when nothing is selected", () => {
    expect(names(filterProjects(projects, { q: "", status: [], category: [], sort: null }))).toEqual([
      "audiobookshelf",
      "gitea",
      "immich",
      "nextcloud",
    ]);
  });

  it("narrows to one selected status", () => {
    expect(names(filterProjects(projects, { q: "", status: ["running"], category: [], sort: null }))).toEqual([
      "nextcloud",
    ]);
  });

  it("shows the union of several selected statuses", () => {
    const result = filterProjects(projects, { q: "", status: ["unhealthy", "partial"], category: [], sort: null });

    expect(names(result)).toEqual(["audiobookshelf", "immich"]);
  });

  it("matches names loosely, and by subsequence", () => {
    expect(names(filterProjects(projects, { q: "next", status: [], category: [], sort: null }))).toEqual(["nextcloud"]);
    expect(names(filterProjects(projects, { q: "abs", status: [], category: [], sort: null }))).toEqual([
      "audiobookshelf",
    ]);
  });

  it("applies the status filter before the query", () => {
    // "nextcloud" matches the query but is running, so the stopped-only filter wins.
    expect(filterProjects(projects, { q: "next", status: ["stopped"], category: [], sort: null })).toEqual([]);
  });

  it("leaves the caller's array untouched", () => {
    const original = [...projects];
    filterProjects(projects, { q: "", status: [], category: [], sort: null });

    expect(projects).toEqual(original);
  });
});

describe("sorting", () => {
  const sorted = (column: Parameters<typeof nextSort>[1], descending: boolean) =>
    names(filterProjects(projects, { q: "", status: [], category: [], sort: { column, descending } }));

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
    const result = filterProjects(wide, {
      q: "",
      status: [],
      category: [],
      sort: { column: "containers", descending: true },
    });

    // A string compare would put "9" after "10".
    expect(names(result)).toEqual(["b", "a"]);
  });

  it("breaks ties on the name so the order survives a refresh", () => {
    // Every project here has one service, so the tie-break is the only thing ordering them.
    expect(sorted("services", false)).toEqual(["audiobookshelf", "gitea", "immich", "nextcloud"]);
    expect(sorted("services", true)).toEqual(["audiobookshelf", "gitea", "immich", "nextcloud"]);
  });

  it("overrides search relevance when a column is chosen", () => {
    const relevance = names(filterProjects(projects, { q: "i", status: [], category: [], sort: null }));
    const byName = names(
      filterProjects(projects, { q: "i", status: [], category: [], sort: { column: "name", descending: true } }),
    );

    expect(byName).toEqual([...relevance].sort((left, right) => right.localeCompare(left)));
  });
});

describe("category filter", () => {
  it("keeps only the selected category", () => {
    expect(names(filterProjects(classified, { q: "", status: [], category: ["media"], sort: null }))).toEqual([
      "immich",
      "nextcloud",
    ]);
  });

  it("unions several categories, and drops the apps in none of them", () => {
    expect(names(filterProjects(classified, { q: "", status: [], category: ["media", "infra"], sort: null }))).toEqual([
      "audiobookshelf",
      "immich",
      "nextcloud",
    ]);
  });

  it("combines with the status filter", () => {
    expect(names(filterProjects(classified, { q: "", status: ["running"], category: ["media"], sort: null }))).toEqual([
      "nextcloud",
    ]);
  });

  it("sorts by category, grouping the unclassified last and breaking ties on the name", () => {
    expect(
      names(
        filterProjects(classified, {
          q: "",
          status: [],
          category: [],
          sort: { column: "category", descending: false },
        }),
      ),
    ).toEqual(["audiobookshelf", "immich", "nextcloud", "gitea"]);
  });

  it("yields nothing for a category no app carries", () => {
    expect(filterProjects(classified, { q: "", status: [], category: ["gaming"], sort: null })).toEqual([]);
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

describe("countBy", () => {
  it("counts each status, and reports nothing for absent ones", () => {
    const counts = countBy([...projects, project("paperless", "running")], entry => entry.status);

    expect(counts).toEqual({ running: 2, stopped: 1, unhealthy: 1, partial: 1 });
  });

  it("leaves apps in no category out of the category counts", () => {
    expect(countBy(classified, entry => entry.category?.name)).toEqual({ media: 2, infra: 1 });
  });
});
