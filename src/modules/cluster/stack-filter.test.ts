import { describe, expect, it } from "vitest";
import type { SwarmStack } from "#libs/docker";
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

const names = (rows: SwarmStack[]) => rows.map(row => row.name);

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
