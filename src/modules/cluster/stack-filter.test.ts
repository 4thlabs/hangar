import { describe, expect, it } from "vitest";
import type { SwarmStack } from "#libs/docker";
import { AppInstallation } from "#modules/apps/installation.ts";
import { ClusterStacks, type ClusterStack } from "./cluster-stacks.ts";
import { ClusterSearch, type ClusterSearchState } from "./search.ts";
import { StackFilter } from "./stack-filter.ts";

const stack = (name: string, overrides: Partial<SwarmStack> = {}): SwarmStack => ({
  name,
  health: "running",
  running: 1,
  desired: 1,
  placement: [{ nodeId: "nas", hostname: "nas", tasks: 1 }],
  ...overrides,
});

const stacks = [
  stack("miniflux", { running: 3, desired: 3, placement: [{ nodeId: "nas", hostname: "nas", tasks: 3 }] }),
  stack("broken", { health: "stopped", running: 0, desired: 2, placement: [] }),
  stack("kuma", { health: "partial", placement: [{ nodeId: "pi", hostname: "pi-01", tasks: 1 }] }),
];

const search = (overrides: Partial<ClusterSearchState> = {}): ClusterSearchState => ({
  q: "",
  health: [],
  node: [],
  origin: [],
  sort: null,
  ...overrides,
});

const names = (rows: ClusterStack[]) => rows.map(row => row.name);

describe("ClusterStacks.list", () => {
  it("adds the installed swarm-ready apps no stack runs yet, by name, as /apps lists an app never started", () => {
    const rows = ClusterStacks.list(stacks, ["miniflux", "adguard"]);

    expect(names(rows)).toEqual(["adguard", "broken", "kuma", "miniflux"]);
    expect(rows[0]).toEqual({ name: "adguard", health: "undeployed", running: 0, desired: 0, placement: [] });
    expect(rows.filter(ClusterStacks.isDeployed)).toHaveLength(3);
  });

  it("adds the swarm-ready store apps that are not installed, unless a stack already has their name", () => {
    const rows = ClusterStacks.list(stacks, [], ["vault", "kuma"]);

    expect(names(rows)).toEqual(["broken", "kuma", "miniflux", "vault"]);
    expect(rows.filter(row => !AppInstallation.isInstalled(row)).map(row => row.name)).toEqual(["vault"]);
    expect(StackFilter.origin(rows.at(-1)!, [])).toBe("hangar");
    expect(ClusterStacks.notInstalled(stacks, ["vault", "kuma"])).toEqual(["vault"]);
  });

  it("leaves a store app that is not installed out of the health filter and its counts, having no stack", () => {
    const rows = ClusterStacks.list(stacks, ["adguard"], ["vault"]);

    expect(names(StackFilter.apply(rows, search({ health: ["undeployed"] }), ["adguard"]))).toEqual(["adguard"]);
    expect(StackFilter.counts(rows, ["adguard"]).health.undeployed).toBe(1);
  });
});

describe("StackFilter.apply", () => {
  it("keeps every stack, by name, when nothing is selected", () => {
    expect(names(StackFilter.apply(stacks, search(), []))).toEqual(["broken", "kuma", "miniflux"]);
  });

  it("keeps the selected healths, the stacks with a task on a selected node, and the selected origin", () => {
    expect(names(StackFilter.apply(stacks, search({ health: ["partial", "stopped"] }), []))).toEqual([
      "broken",
      "kuma",
    ]);

    expect(names(StackFilter.apply(stacks, search({ node: ["pi-01"] }), []))).toEqual(["kuma"]);
    expect(names(StackFilter.apply(stacks, search({ origin: ["hangar"] }), ["miniflux"]))).toEqual(["miniflux"]);
  });

  it("sorts on a column, health from the best, ties broken by name", () => {
    const byHealth = StackFilter.apply(stacks, search({ sort: { column: "health", descending: true } }), []);
    const byReplicas = StackFilter.apply(stacks, search({ sort: { column: "replicas", descending: false } }), []);

    expect(names(byHealth)).toEqual(["broken", "kuma", "miniflux"]);
    expect(names(byReplicas)).toEqual(["kuma", "broken", "miniflux"]);
  });

  it("finds a stack by a part of its name", () => {
    expect(names(StackFilter.apply(stacks, search({ q: "flux" }), []))).toEqual(["miniflux"]);
  });

  it("keeps the undeployed apps apart, and sorts them after the stopped stacks", () => {
    const rows = ClusterStacks.list(stacks, ["adguard"]);
    const byHealth = StackFilter.apply(rows, search({ sort: { column: "health", descending: false } }), ["adguard"]);

    expect(names(StackFilter.apply(rows, search({ health: ["undeployed"] }), ["adguard"]))).toEqual(["adguard"]);
    expect(names(byHealth)).toEqual(["miniflux", "kuma", "broken", "adguard"]);
  });
});

describe("StackFilter.counts", () => {
  it("counts the stacks under each option", () => {
    expect(StackFilter.counts(stacks, ["miniflux"])).toEqual({
      health: { running: 1, stopped: 1, partial: 1 },
      node: { nas: 1, "pi-01": 1 },
      origin: { hangar: 1, other: 2 },
    });
  });
});

describe("ClusterSearch.Codec", () => {
  it("round-trips a search, dropping unknown values", () => {
    const parsed = ClusterSearch.Codec.parse("q=mini&health=partial,bogus&node=nas&origin=hangar&sort=-replicas");

    expect(parsed).toEqual({
      q: "mini",
      health: ["partial"],
      node: ["nas"],
      origin: ["hangar"],
      sort: { column: "replicas", descending: true },
    });

    expect(ClusterSearch.Codec.parse(ClusterSearch.Codec.serialize(parsed))).toEqual(parsed);
  });
});
