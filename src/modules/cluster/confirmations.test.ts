import { describe, expect, it } from "vitest";
import type { SwarmCluster, SwarmNode } from "#libs/docker";
import { nodeActionConfirmation } from "./confirmations.ts";

const node = (overrides: Partial<SwarmNode> = {}): SwarmNode => ({
  id: "nas",
  hostname: "nas",
  role: "manager",
  status: "ready",
  availability: "active",
  cpus: 4,
  memoryBytes: 0,
  engineVersion: "29.1.3",
  stacks: [{ name: "miniflux", health: "running", tasks: 2 }],
  actions: [],
  ...overrides,
});

const cluster: Extract<SwarmCluster, { state: "manager" }> = {
  state: "manager",
  clusterId: "nhyx6n1b8b0a0zqlwjr4bx7xd",
  currentNodeId: "nas",
  managers: 3,
  faultTolerance: 1,
  faultToleranceAfter: { promote: 1, demote: 0 },
  nodes: [],
};

describe("nodeActionConfirmation", () => {
  it("states the fault tolerance after a demotion", () => {
    const { title, description } = nodeActionConfirmation(cluster, node({ id: "pi", hostname: "pi-01" }), "demote");

    expect(title).toBe("Rétrograder pi-01 ?");
    expect(description).toContain("tolérera ensuite 0 panne de manager");
  });

  it("warns that demoting Hangar's own node hides the cluster from it", () => {
    expect(nodeActionConfirmation(cluster, node(), "demote").description).toContain("il ne verra plus le cluster");
  });

  it("says where a drained node's tasks go, and that the tolerance does not move", () => {
    const { description } = nodeActionConfirmation(cluster, node(), "drain");

    expect(description).toContain("Les 2 tâches de nas seront replacées");
    expect(description).toContain("tolérera ensuite 1 panne de manager");
  });

  it("marks only the removal and the demotion as destructive", () => {
    expect(nodeActionConfirmation(cluster, node(), "remove").destructive).toBe(true);
    expect(nodeActionConfirmation(cluster, node(), "demote").destructive).toBe(true);
    expect(nodeActionConfirmation(cluster, node(), "drain").destructive).toBe(false);
  });
});
