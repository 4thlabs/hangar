import { describe, expect, it } from "vitest";
import { managerView, swarmNodeView } from "#libs/docker/mock";
import { Translation } from "#libs/i18n";
import { ClusterMessages } from "#modules/cluster/messages.ts";
import { NodeActionConfirmations } from "./confirmations.ts";

const node = (overrides: Parameters<typeof swarmNodeView>[0] = {}) =>
  swarmNodeView({
    id: "nas",
    role: "manager",
    tasks: 2,
    ...overrides,
  });

const cluster = managerView({ currentNodeId: "nas", managers: 3 });
const fr = Translation.create(ClusterMessages, "fr");
const en = Translation.create(ClusterMessages, "en");

describe("NodeActionConfirmations.create", () => {
  it("states the fault tolerance after a demotion", () => {
    const { title, description } = NodeActionConfirmations.create(
      cluster,
      node({ id: "pi", hostname: "pi-01" }),
      "demote",
      fr,
    );

    expect(title).toBe("Rétrograder pi-01 ?");
    expect(description).toContain("tolérera ensuite 0 panne de manager");
  });

  it("words the confirmation in the reader's language", () => {
    const { title, description } = NodeActionConfirmations.create(cluster, node(), "drain", en);

    expect(title).toBe("Drain nas?");
    expect(description).toContain("The 2 tasks of nas will move to the other nodes.");
    expect(description).toContain("tolerate 1 manager failure");
  });

  it("warns that demoting Hangar's own node hides the cluster from it", () => {
    expect(NodeActionConfirmations.create(cluster, node(), "demote", fr).description).toContain(
      "il ne verra plus le cluster",
    );
  });

  it("says where a drained node's tasks go, and that the tolerance does not move", () => {
    const { description } = NodeActionConfirmations.create(cluster, node(), "drain", fr);

    expect(description).toContain("Les 2 tâches de nas seront replacées");
    expect(description).toContain("tolérera ensuite 1 panne de manager");
  });

  it("marks only the removal and the demotion as destructive", () => {
    expect(NodeActionConfirmations.create(cluster, node(), "remove", en).destructive).toBe(true);
    expect(NodeActionConfirmations.create(cluster, node(), "demote", en).destructive).toBe(true);
    expect(NodeActionConfirmations.create(cluster, node(), "drain", en).destructive).toBe(false);
  });
});
