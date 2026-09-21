import { describe, expect, it } from "vitest";
import type { AppsSearch } from "#app/search-codecs.ts";
import type { ComposeProjectSummary } from "#libs/docker";
import { countBy, filterProjects, nextSort, updateState } from "./filter.ts";

/** The `/apps` search params, defaulting every dimension to "no filter". */
const search = (selected: Partial<AppsSearch> = {}): AppsSearch => ({
  q: "",
  status: [],
  category: [],
  update: [],
  sort: null,
  ...selected,
});

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

/** The same four apps after a version check: two behind, one current, one never checked. */
const checked = [
  { ...project("nextcloud", "running"), updateAvailable: true },
  { ...project("gitea", "stopped"), updateAvailable: false },
  { ...project("immich", "unhealthy"), updateAvailable: true },
  project("audiobookshelf", "partial"),
];

const names = (result: ComposeProjectSummary[]) => result.map(entry => entry.name);

describe("filterProjects", () => {
  it("shows everything, alphabetically, when nothing is selected", () => {
    expect(names(filterProjects(projects, search()))).toEqual(["audiobookshelf", "gitea", "immich", "nextcloud"]);
  });

  it("narrows to one selected status", () => {
    expect(names(filterProjects(projects, search({ status: ["running"] })))).toEqual(["nextcloud"]);
  });

  it("shows the union of several selected statuses", () => {
    const result = filterProjects(projects, search({ status: ["unhealthy", "partial"] }));

    expect(names(result)).toEqual(["audiobookshelf", "immich"]);
  });

  it("matches names loosely, and by subsequence", () => {
    expect(names(filterProjects(projects, search({ q: "next" })))).toEqual(["nextcloud"]);
    expect(names(filterProjects(projects, search({ q: "abs" })))).toEqual(["audiobookshelf"]);
  });

  it("applies the status filter before the query", () => {
    // "nextcloud" matches the query but is running, so the stopped-only filter wins.
    expect(filterProjects(projects, search({ q: "next", status: ["stopped"] }))).toEqual([]);
  });

  it("leaves the caller's array untouched", () => {
    const original = [...projects];
    filterProjects(projects, search());

    expect(projects).toEqual(original);
  });
});

describe("sorting", () => {
  const sorted = (column: Parameters<typeof nextSort>[1], descending: boolean) =>
    names(filterProjects(projects, search({ sort: { column, descending } })));

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
    const result = filterProjects(wide, search({ sort: { column: "containers", descending: true } }));

    // A string compare would put "9" after "10".
    expect(names(result)).toEqual(["b", "a"]);
  });

  it("breaks ties on the name so the order survives a refresh", () => {
    // Every project here has one service, so the tie-break is the only thing ordering them.
    expect(sorted("services", false)).toEqual(["audiobookshelf", "gitea", "immich", "nextcloud"]);
    expect(sorted("services", true)).toEqual(["audiobookshelf", "gitea", "immich", "nextcloud"]);
  });

  it("overrides search relevance when a column is chosen", () => {
    const relevance = names(filterProjects(projects, search({ q: "i" })));
    const byName = names(filterProjects(projects, search({ q: "i", sort: { column: "name", descending: true } })));

    expect(byName).toEqual([...relevance].sort((left, right) => right.localeCompare(left)));
  });
});

describe("category filter", () => {
  it("keeps only the selected category", () => {
    expect(names(filterProjects(classified, search({ category: ["media"] })))).toEqual(["immich", "nextcloud"]);
  });

  it("unions several categories, and drops the apps in none of them", () => {
    expect(names(filterProjects(classified, search({ category: ["media", "infra"] })))).toEqual([
      "audiobookshelf",
      "immich",
      "nextcloud",
    ]);
  });

  it("combines with the status filter", () => {
    expect(names(filterProjects(classified, search({ status: ["running"], category: ["media"] })))).toEqual([
      "nextcloud",
    ]);
  });

  it("sorts by category, grouping the unclassified last and breaking ties on the name", () => {
    expect(names(filterProjects(classified, search({ sort: { column: "category", descending: false } })))).toEqual([
      "audiobookshelf",
      "immich",
      "nextcloud",
      "gitea",
    ]);
  });

  it("yields nothing for a category no app carries", () => {
    expect(filterProjects(classified, search({ category: ["gaming"] }))).toEqual([]);
  });
});

describe("update filter", () => {
  it("keeps only the apps with an update", () => {
    expect(names(filterProjects(checked, search({ update: ["available"] })))).toEqual(["immich", "nextcloud"]);
  });

  it("counts the never-checked apps as up to date", () => {
    // `audiobookshelf` has no `updateAvailable` at all, and its row shows no badge either.
    expect(names(filterProjects(checked, search({ update: ["current"] })))).toEqual(["audiobookshelf", "gitea"]);
  });

  it("filters nothing when both states are selected", () => {
    expect(names(filterProjects(checked, search({ update: ["available", "current"] })))).toEqual(
      names(filterProjects(checked, search())),
    );
  });

  it("combines with the status filter", () => {
    expect(names(filterProjects(checked, search({ status: ["running"], update: ["available"] })))).toEqual([
      "nextcloud",
    ]);
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

  it("splits the update states in two", () => {
    expect(countBy(checked, updateState)).toEqual({ available: 2, current: 2 });
  });
});
