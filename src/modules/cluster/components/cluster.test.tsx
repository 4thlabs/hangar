import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SwarmCluster } from "#libs/docker";

vi.mock("waku", () => ({
  useRouter: () => ({ reload: async () => {} }),
}));

// Server actions are a module boundary the render never crosses.
vi.mock("#modules/cluster/actions/manage-cluster.ts", () => ({}));
vi.mock("#modules/cluster/actions/manage-stacks.ts", () => ({}));

const { managerView, swarmNodeView: node } = await import("#libs/docker/mock");
const { ClusterOverview } = await import("./cluster-overview.tsx");

const render = (cluster: SwarmCluster) =>
  renderToStaticMarkup(<ClusterOverview cluster={cluster} manageableStacks={[]} />);

const manager = managerView({
  managers: 2,
  nodes: [
    node({ stacks: [{ name: "miniflux", health: "partial", tasks: 2 }] }),
    node({
      id: "node-2",
      hostname: "pi-02",
      role: "worker",
      status: "down",
      availability: "drain",
      actions: ["promote", "activate", "remove"],
    }),
  ],
});

describe("ClusterOverview", () => {
  it("sums the cluster up under the title, with the short id", () => {
    expect(render(manager)).toContain("nhyx6n1b8b0a · 2 nœuds · 2 managers (tolère 0 panne)");
  });

  it("draws one card per node, marking this one, with the stacks running on it", () => {
    const html = render(manager);

    expect(html).toContain("★ ce nœud");
    expect(html.match(/★ ce nœud/g)).toHaveLength(1);
    expect(html).toContain("8 CPU · 32 GiB · Docker 29.1.3");
    expect(html).toContain("miniflux");
    expect(html).toContain("◐");
    expect(html).toContain("2 tâches");
  });

  it("shows an unreachable, drained worker for what it is", () => {
    const html = render(manager);

    expect(html).toContain("Injoignable");
    expect(html).toContain("Drainé");
    expect(html).toContain("Aucune app");
  });

  const emptyStates: [SwarmCluster, string][] = [
    [{ state: "inactive", error: "" }, "Créer le cluster"],
    [{ state: "locked", error: "" }, "docker swarm unlock"],
    [{ state: "worker", managers: ["192.168.1.10:2377"] }, "192.168.1.10:2377"],
    [{ state: "error", error: "manager unreachable" }, "manager unreachable"],
  ];

  it.each(emptyStates)("explains the %o state", (cluster, expected) => {
    expect(render(cluster)).toContain(expected);
  });

  it("offers on each card the actions that apply to its node, and the tokens on a manager", () => {
    const html = render(manager);

    expect(html).toContain("Réactiver");
    expect(html).toContain("Retirer");
    expect(html).toContain("Tokens");
  });

  it("offers a node in no swarm to create one or to join one", () => {
    const html = render({ state: "inactive", error: "" });

    expect(html).toContain("Créer le cluster");
    expect(html).toContain("Rejoindre un cluster");
    expect(html).not.toContain("Tokens");
  });

  it("offers a retry when the daemon fails", () => {
    const html = renderToStaticMarkup(<ClusterOverview error="Le daemon Docker ne répond pas." />);

    expect(html).toContain("Swarm indisponible");
    expect(html).toContain("Réessayer");
  });
});
