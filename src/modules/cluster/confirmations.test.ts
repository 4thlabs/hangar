import { describe, expect, it } from "vitest";
import { managerView, swarmNodeView } from "#libs/docker/mock";
import { NodeActionConfirmations } from "./confirmations.ts";

const node = (overrides: Parameters<typeof swarmNodeView>[0] = {}) =>
  swarmNodeView({
    id: "nas",
    role: "manager",
    tasks: 2,
    ...overrides,
  });

const cluster = managerView({ currentNodeId: "nas", managers: 3 });

describe("NodeActionConfirmations.of", () => {
  it("states the fault tolerance after a demotion", () => {
    const { title, description } = NodeActionConfirmations.of(cluster, node({ id: "pi", hostname: "pi-01" }), "demote");

    expect(title).toBe("Rétrograder pi-01 ?");
    expect(description).toContain("tolérera ensuite 0 panne de manager");
  });

  it("warns that demoting Hangar's own node hides the cluster from it", () => {
    expect(NodeActionConfirmations.of(cluster, node(), "demote").description).toContain("il ne verra plus le cluster");
  });

  it("says where a drained node's tasks go, and that the tolerance does not move", () => {
    const { description } = NodeActionConfirmations.of(cluster, node(), "drain");

    expect(description).toContain("Les 2 tâches de nas seront replacées");
    expect(description).toContain("tolérera ensuite 1 panne de manager");
  });

  it("marks only the removal and the demotion as destructive", () => {
    expect(NodeActionConfirmations.of(cluster, node(), "remove").destructive).toBe(true);
    expect(NodeActionConfirmations.of(cluster, node(), "demote").destructive).toBe(true);
    expect(NodeActionConfirmations.of(cluster, node(), "drain").destructive).toBe(false);
  });
});
