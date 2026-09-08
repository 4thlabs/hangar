import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Dashboard } from "#libs/api";
import { ArcaneGeneralStatsCard, ArcaneGeneralStatsError } from "./general-stats.tsx";

const dashboard: Dashboard = {
  versionInfo: {
    updateAvailable: false,
    releaseUrl: "https://github.com/getarcaneapp/arcane/releases/latest",
    displayVersion: "v2.18.1",
    newestVersion: "v2.18.1",
  },
  containers: {
    counts: {
      totalContainers: 24,
      runningContainers: 22,
      stoppedContainers: 2,
    },
  },
  imageUsageCounts: {
    totalImages: 31,
    imagesUnused: 7,
    totalImageSize: 13_421_772_800,
  },
  volumeUsageCounts: {
    total: 18,
    inuse: 15,
    unused: 3,
  },
  actionItems: {
    items: [],
  },
};

describe("ArcaneGeneralStatsCard", () => {
  it("renders the general Arcane metrics and their visible details", () => {
    const html = renderToStaticMarkup(
      <ArcaneGeneralStatsCard dashboard={dashboard} serviceUrl="https://arcane.example.com" />,
    );

    expect(html).toContain("v2.18.1");
    expect(html).toContain("24 containers");
    expect(html).toContain("Running");
    expect(html).toContain("22");
    expect(html).toContain("Stopped");
    expect(html).toContain("2");
    expect(html).toContain("7 unused · 12.5 GB");
    expect(html).toContain("15 in use · 3 unused");
    expect(html).not.toContain("Needs attention");
  });

  it("renders an available update and action items", () => {
    const html = renderToStaticMarkup(
      <ArcaneGeneralStatsCard
        serviceUrl="https://arcane.example.com"
        dashboard={{
          ...dashboard,
          versionInfo: {
            ...dashboard.versionInfo,
            updateAvailable: true,
            newestVersion: "v2.19.0",
          },
          actionItems: {
            items: [{ severity: "critical", count: 3, kind: "container_updates" }],
          },
        }}
      />,
    );

    expect(html).toContain("v2.18.1 → v2.19.0");
    expect(html).toContain("Needs attention");
    expect(html).toContain("3</span> container updates");
    expect(html).toContain("text-destructive");
  });
});

describe("ArcaneGeneralStatsError", () => {
  it("keeps failure details generic", () => {
    const html = renderToStaticMarkup(<ArcaneGeneralStatsError />);

    expect(html).toContain("Arcane is unavailable");
    expect(html).toContain("The rest of the dashboard is still available.");
  });
});
