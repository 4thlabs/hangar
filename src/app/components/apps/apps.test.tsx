import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ComposeContainer, ComposeProjectsSnapshot } from "#libs/docker/projects.ts";

vi.mock("waku", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/apps/alpha">{children}</a>,
  useRouter: () => ({ reload: async () => {} }),
}));
vi.mock("waku/router/client", () => ({
  useSearch_UNSTABLE: () => ({ q: "", status: [], sort: null }),
  useSetSearch_UNSTABLE: () => () => {},
}));

const noSearch = { q: "", status: [], sort: null };

const { AppsTable } = await import("./apps-table.tsx");
const { AppsOverview } = await import("./apps-overview.tsx");
const { ContainerTable } = await import("./container-table.tsx");

const snapshot: ComposeProjectsSnapshot = {
  projects: [
    {
      name: "alpha",
      status: "partial",
      serviceCount: 2,
      containerCount: 3,
      runningCount: 2,
      stoppedCount: 1,
      unhealthyCount: 0,
      containerIds: ["container-1", "container-2", "container-3"],
    },
  ],
};

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
      containerCount: 0,
      runningCount: 0,
      stoppedCount: 0,
    };
    const html = renderToStaticMarkup(<AppsTable projects={[...snapshot.projects, stopped]} />);

    expect(html).toContain("alpha");
    expect(html).toContain("Partiel");
    expect(html).toContain("gamma");
    expect(html).toContain("Arrêté");
    expect(html).toContain('aria-label="Sélectionner gamma"');
    expect(html).toContain('aria-label="Tout sélectionner"');
    // The name itself is the link now; the trailing "Détails" button is gone.
    expect(html).toContain('<a href="/apps/alpha">alpha</a>');
    expect(html).not.toContain("Détails");
  });

  it("marks the sorted column for assistive tech and leaves the others neutral", () => {
    const html = renderToStaticMarkup(
      <AppsTable
        projects={snapshot.projects}

        sort={{ column: "services", descending: true }}
      />,
    );

    expect(html).toContain('aria-sort="descending"');
    expect(html.match(/aria-sort="none"/g)).toHaveLength(4);
    // Every sortable header is a real button, so it is keyboard reachable.
    expect(html.match(/<th[^>]*aria-sort[^>]*><button/g)).toHaveLength(5);
  });

  it("renders the empty Compose inventory state", () => {
    const html = renderToStaticMarkup(
      <AppsOverview snapshot={{ ...snapshot, projects: [] }} error={null} search={noSearch} />,
    );

    expect(html).toContain("Aucune application installée");
    expect(html).toContain("Conteneurs actifs");
  });

  it("renders daemon errors without inventing project data", () => {
    const html = renderToStaticMarkup(<AppsOverview snapshot={null} error="Socket inaccessible" search={noSearch} />);

    expect(html).toContain("Docker indisponible");
    expect(html).toContain("Socket inaccessible");
  });

  it("renders live metrics from the stats frame, ports and the logs action", () => {
    const html = renderToStaticMarkup(<ContainerTable stats={stats} project="alpha" containers={[container]} />);

    expect(html).toContain("alpha-web-1");
    expect(html).toContain("nginx:latest");
    expect(html).toContain("8080");
    expect(html).toContain("12.5 %");
    expect(html).toContain("Logs");
  });

  it("shows dashes for a container the stats stream has no frame for", () => {
    const html = renderToStaticMarkup(<ContainerTable stats={{}} project="alpha" containers={[container]} />);

    expect(html).toContain("alpha-web-1");
    expect(html).not.toContain("12.5 %");
  });
});
