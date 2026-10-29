import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ComposeContainer, ComposeProjectsSnapshot } from "#libs/docker";

vi.mock("waku", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/apps/alpha">{children}</a>,
  useRouter: () => ({ reload: async () => {} }),
}));

vi.mock("waku/router/client", () => ({
  useSearch_UNSTABLE: () => ({ q: "", status: [], category: [], update: [], sort: null }),
  useSetSearch_UNSTABLE: () => () => {},
}));

vi.mock("#modules/apps/actions/install-app.ts", () => ({ installApp: vi.fn(), uninstallApp: vi.fn() }));

const noSearch = { q: "", status: [], category: [], update: [], sort: null };

const { AppsTable } = await import("./apps-table.tsx");
const { AppsOverview } = await import("./apps-overview.tsx");
const { ContainerTable } = await import("./container-table.tsx");

const snapshot: ComposeProjectsSnapshot = {
  projects: [
    {
      name: "alpha",
      status: "partial",
      serviceCount: 2,
      runningCount: 2,
      unhealthyCount: 0,
      containerIds: ["container-1", "container-2", "container-3"],
    },
  ],
};

/** A store app that is not installed, as the page lists it. */
const zulu = {
  name: "zulu",
  status: "stopped",
  serviceCount: 0,
  runningCount: 0,
  unhealthyCount: 0,
  containerIds: [],
  installed: false,
} as const satisfies ComposeProjectsSnapshot["projects"][number];

const container: ComposeContainer = {
  id: "a".repeat(64),
  name: "alpha-web-1",
  service: "web",
  replica: 1,
  image: "nginx:latest",
  state: "running",
  health: "healthy",
  restartCount: 2,
  ports: [{ IP: "0.0.0.0", PrivatePort: 80, PublicPort: 8080, Type: "tcp" }],
};

/** One frame of the stats stream, keyed by container id the way the SSE route sends it. */
const stats = {
  [container.id]: {
    cpuPercent: 12.5,
    memoryUsage: 1024,
    memoryLimit: 2048,
    memoryPercent: 50,
    networkRx: 100,
    networkTx: 200,
    blockRead: 300,
    blockWrite: 400,
  },
};

describe("Docker apps views", () => {
  it("lists apps with their status, counts and a selection checkbox", () => {
    const stopped = {
      ...snapshot.projects[0]!,
      name: "gamma",
      status: "stopped" as const,
      serviceCount: 0,
      runningCount: 0,
      containerIds: [],
    };

    const html = renderToStaticMarkup(<AppsTable projects={[...snapshot.projects, stopped]} />);

    expect(html).toContain("alpha");
    expect(html).toContain("Partiel");
    expect(html).toContain("gamma");
    expect(html).toContain("Arrêté");
    expect(html).toContain('aria-label="Sélectionner gamma"');
    expect(html).toContain('aria-label="Tout sélectionner"');
    // The name is the link; there is no separate "Détails" button.
    expect(html).toContain('<a href="/apps/alpha">alpha</a>');
    expect(html).not.toContain("Détails");
  });

  it("offers Up's flags in its menu, none ticked, instead of a button per variant", () => {
    const html = renderToStaticMarkup(<AppsTable projects={snapshot.projects} />);

    expect(html).toContain('title="docker compose up -d"');
    expect(html).toContain('aria-label="Options de Up"');
    expect(html).toContain('title="docker compose restart"');
    expect(html).toContain('title="docker compose down"');
    // The menu renders its checkboxes only once opened.
    expect(html).not.toContain("--force-recreate");
    expect(html).not.toContain("--pull always");
  });

  it("marks the sorted column for assistive tech and leaves the others neutral", () => {
    const html = renderToStaticMarkup(
      <AppsTable
        projects={snapshot.projects}

        sort={{ column: "services", descending: true }}
      />,
    );

    expect(html).toContain('aria-sort="descending"');
    expect(html.match(/aria-sort="none"/g)).toHaveLength(5);
    // Every sortable header is a real button, so it is keyboard reachable.
    expect(html.match(/<th[^>]*aria-sort[^>]*><button/g)).toHaveLength(6);
  });

  it("lists the store apps that are not installed only when asked, without counting them as Docker's", () => {
    const hidden = renderToStaticMarkup(
      <AppsOverview snapshot={snapshot} uninstalled={[zulu]} error={null} search={noSearch} showUninstalled={false} />,
    );

    const shown = renderToStaticMarkup(
      <AppsOverview snapshot={snapshot} uninstalled={[zulu]} error={null} search={noSearch} showUninstalled />,
    );

    expect(hidden).not.toContain("zulu");
    expect(hidden).toContain('aria-pressed="false"');
    expect(shown).toContain("zulu");
    expect(shown).toContain("Non installée");
    expect(shown).toContain("Installer");
    // Only alpha can be picked for a compose run.
    expect(shown).not.toContain("Sélectionner zulu");
  });

  it("still lists the store apps that are not installed when Docker is down, to install one", () => {
    const html = renderToStaticMarkup(
      <AppsOverview
        snapshot={null}
        uninstalled={[zulu]}
        error="Socket inaccessible"
        search={noSearch}
        showUninstalled
      />,
    );

    expect(html).toContain("Docker indisponible");
    expect(html).toContain("zulu");
    expect(html).toContain("Installer");
  });

  it("renders the empty Compose inventory state", () => {
    const html = renderToStaticMarkup(
      <AppsOverview
        snapshot={{ ...snapshot, projects: [] }}
        uninstalled={[]}
        error={null}
        search={noSearch}
        showUninstalled={false}
      />,
    );

    expect(html).toContain("Aucune application installée");
    expect(html).toContain("Conteneurs actifs");
  });

  it("renders daemon errors without inventing project data", () => {
    const html = renderToStaticMarkup(
      <AppsOverview
        snapshot={null}
        uninstalled={[]}
        error="Socket inaccessible"
        search={noSearch}
        showUninstalled={false}
      />,
    );

    expect(html).toContain("Docker indisponible");
    expect(html).toContain("Socket inaccessible");
  });

  it("renders live metrics from the stats frame, ports and the console action", () => {
    const html = renderToStaticMarkup(<ContainerTable stats={stats} project="alpha" containers={[container]} />);

    expect(html).toContain("alpha-web-1");
    expect(html).toContain("nginx:latest");
    expect(html).toContain("8080");
    expect(html).toContain("12.5 %");
    expect(html).toContain("Ouvrir la console de alpha-web-1");
  });

  it("offers only the logs of a container that is not running: Docker runs no exec in it", () => {
    const stopped = { ...container, state: "exited" };
    const html = renderToStaticMarkup(<ContainerTable stats={stats} project="alpha" containers={[stopped]} />);

    expect(html).toContain("Voir les logs de alpha-web-1");
    expect(html).not.toContain("Ouvrir la console");
  });

  it("shows dashes for a container the stats stream has no frame for", () => {
    const html = renderToStaticMarkup(<ContainerTable stats={{}} project="alpha" containers={[container]} />);

    expect(html).toContain("alpha-web-1");
    expect(html).not.toContain("12.5 %");
  });
});
