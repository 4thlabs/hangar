import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SwarmCluster } from "#libs/docker";

vi.mock("waku", () => ({
  useRouter: () => ({ reload: async () => {} }),
}));

vi.mock("waku/router/client", () => ({
  useSearch_UNSTABLE: () => noSearch,
  useSetSearch_UNSTABLE: () => () => {},
}));

/** No filter, no sort: every stack, by name. */
const noSearch = { q: "", health: [], node: [], origin: [], sort: null };

// Server actions are a module boundary the render never crosses.
vi.mock("#modules/cluster/actions/manage-cluster.ts", () => ({}));
vi.mock("#modules/cluster/actions/manage-stacks.ts", () => ({}));

const { managerView, swarmNodeView: node } = await import("#libs/docker/mock");
const { ClusterOverview } = await import("./cluster-overview.tsx");

const render = (cluster: SwarmCluster) =>
  renderToStaticMarkup(<ClusterOverview cluster={cluster} manageableStacks={[]} search={noSearch} />);

const manager = managerView({
  managers: 2,
  stacks: [
    {
      name: "miniflux",
      health: "partial",
      running: 2,
      desired: 3,
      placement: [{ nodeId: "node-1", hostname: "nas", tasks: 2 }],
    },
    { name: "broken", health: "stopped", running: 0, desired: 1, placement: [] },
  ],
  nodes: [
    node({ tasks: 2 }),
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

  it("draws one card per node, marking this one, with how many tasks it runs", () => {
    const html = render(manager);

    expect(html.match(/★ ce nœud/g)).toHaveLength(1);
    expect(html).toContain("8 CPU · 32 GiB · Docker 29.1.3");
    expect(html).toContain("2 tâches");
  });

  it("lists each stack once, with its replicas and where its tasks run, the idle ones included", () => {
    const html = renderToStaticMarkup(
      <ClusterOverview cluster={manager} manageableStacks={["miniflux"]} search={noSearch} />,
    );

    expect(html.match(/>miniflux</g)).toHaveLength(1);
    expect(html).toContain("◐");
    expect(html).toContain("2/3");
    expect(html).toContain("nas · 2");
    expect(html).toContain("Hangar");
    expect(html).toContain("broken");
    expect(html).toContain("aucune tâche");
  });

  it("shows an unreachable, drained worker for what it is", () => {
    const html = render(manager);

    expect(html).toContain("Injoignable");
    expect(html).toContain("Drainé");
    expect(html).toContain("Aucune tâche");
  });

  it("shows a node's labels, the ones from the host's daemon.json marked apart", () => {
    const labelled = managerView({
      nodes: [node({ labels: { zone: "home", gpu: "" }, engineLabels: { arch: "arm64" } })],
    });

    const html = render(labelled);

    expect(html).toContain(">gpu<");
    expect(html).toContain(">zone=home<");
    expect(html).toContain("Label du moteur, défini dans le daemon.json de l’hôte : </span>");
    expect(html).toContain(">arch=arm64<");
  });

  it("offers every node its labels, the unreachable one included, and lists none when it has none", () => {
    const html = render(manager);

    expect(html.match(/>Labels</g)).toHaveLength(2);
    expect(html).not.toContain('aria-label="Labels"');
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

  it("says so when the filters keep no stack", () => {
    const html = renderToStaticMarkup(
      <ClusterOverview cluster={manager} manageableStacks={[]} search={{ ...noSearch, health: ["running"] }} />,
    );

    expect(html).toContain("Aucune stack ne correspond à ces filtres.");
  });

  it("offers a retry when the daemon fails", () => {
    const html = renderToStaticMarkup(<ClusterOverview error="Le daemon Docker ne répond pas." search={noSearch} />);

    expect(html).toContain("Swarm indisponible");
    expect(html).toContain("Réessayer");
  });
});
