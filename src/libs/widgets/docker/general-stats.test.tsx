import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("waku", () => ({
  Link: ({ children, to }: { children: ReactNode; to: { params: { project: string } } }) => (
    <a href={`/apps/${to.params.project}`}>{children}</a>
  ),
}));

const { DockerGeneralStatsCard } = await import("./general-stats.tsx");

describe("DockerGeneralStatsCard", () => {
  it("renders the local Docker metrics and their visible details", () => {
    const html = renderToStaticMarkup(
      <DockerGeneralStatsCard
        overview={{
          version: "27.3.1",
          containers: { total: 24, running: 22, stopped: 2 },
          images: { total: 31, unused: 7, size: 13_421_772_800 },
          volumes: { total: 18, inUse: 15, unused: 3 },
        }}
        outdated={[]}
      />,
    );

    expect(html).toContain("Docker 27.3.1");
    expect(html).toContain("24 containers");
    expect(html).toContain(">22<");
    expect(html).toContain("7 unused · 12.5 GB");
    expect(html).toContain("15 in use · 3 unused");
    expect(html).not.toContain("Updates available");
  });

  it("links the apps whose image is behind its registry", () => {
    const html = renderToStaticMarkup(
      <DockerGeneralStatsCard
        overview={{
          version: "27.3.1",
          containers: { total: 1, running: 1, stopped: 0 },
          images: { total: 1, unused: 0, size: 0 },
          volumes: { total: 0, inUse: 0, unused: 0 },
        }}
        outdated={["alpha", "beta"]}
      />,
    );

    expect(html).toContain("Updates available");
    expect(html).toContain('href="/apps/alpha"');
    expect(html).toContain('href="/apps/beta"');
  });
});
