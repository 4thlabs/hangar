import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackrestRepoSummary } from "./api/client.ts";
import { BackrestSummaryCard, backrestSummary, displayRepo } from "./summary.tsx";
import { aService, clearWidgetCache } from "../mock/mock.ts";

afterEach(() => vi.unstubAllGlobals());
beforeEach(clearWidgetCache);

const service = {
  api: "http://backrest:9898",
  link: "https://backup.test.local",
  apiKey: () => Promise.resolve(undefined),
};

/** Fixed, so "2 hours ago" is a fact rather than a race with the clock. */
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

/** As Connect sends it: every int64 a string, defaults omitted. */
const healthy: BackrestRepoSummary = {
  id: "homelab-b2",
  backupsSuccessLast30days: "28",
  bytesAddedLast30days: "4509715660",
  protectedBytes: "657129280307",
  nextBackupTimeMs: String(NOW + 79_200_000),
  recentBackups: {
    status: ["STATUS_SUCCESS", "STATUS_SUCCESS"],
    timestampMs: [String(NOW - 7_200_000), String(NOW - 93_600_000)],
  },
};

describe("displayRepo", () => {
  it("reads Connect's string int64s as numbers and trims the status prefix", () => {
    expect(displayRepo(healthy)).toEqual({
      id: "homelab-b2",
      status: "SUCCESS",
      ok: true,
      lastRunAt: NOW - 7_200_000,
      successes: 28,
      bytesAdded: 4_509_715_660,
      protectedBytes: 657_129_280_307,
      nextBackupAt: NOW + 79_200_000,
    });
  });

  it("treats every omitted field as the zero Connect declined to send", () => {
    // A repository configured but never run: no `recentBackups`, no counts, no next run.
    expect(displayRepo({ id: "fresh" })).toEqual({
      id: "fresh",
      status: undefined,
      ok: false,
      lastRunAt: undefined,
      successes: 0,
      bytesAdded: 0,
      protectedBytes: 0,
      nextBackupAt: undefined,
    });
  });

  it("counts anything that is not a success as unhealthy", () => {
    const failed = displayRepo({ ...healthy, recentBackups: { status: ["STATUS_ERROR"], timestampMs: ["1"] } });

    expect(failed).toMatchObject({ status: "ERROR", ok: false });
  });
});

describe("BackrestSummaryCard", () => {
  it("sums what every repository protects into the header", () => {
    const html = renderToStaticMarkup(
      <BackrestSummaryCard
        repos={[displayRepo(healthy), displayRepo({ ...healthy, id: "local-usb", protectedBytes: "869730877440" })]}
        serviceUrl="https://backup.test.local"
        now={NOW}
      />,
    );

    expect(html).toContain("2 repos");
    expect(html).toContain("1.4 TB protected");
    expect(html).toContain("https://backup.test.local");
  });

  it("shows the last run, the 30-day tally and when the next one is due", () => {
    const html = renderToStaticMarkup(
      <BackrestSummaryCard repos={[displayRepo(healthy)]} serviceUrl="https://backup.test.local" now={NOW} />,
    );

    expect(html).toContain("homelab-b2");
    expect(html).toContain("SUCCESS");
    expect(html).toContain("28 ok / 30d");
    expect(html).toContain("4.2 GB added");
    expect(html).toContain("612.0 GB protected");
    // Compact, as Glance writes it: a row carrying five other facts cannot spend "2 hours ago".
    expect(html).toContain("2h");
    expect(html).toContain("next in 22h");
  });

  it("marks a failed repository in words, not only in colour", () => {
    const failed = displayRepo({ ...healthy, recentBackups: { status: ["STATUS_ERROR"], timestampMs: [String(NOW)] } });
    const html = renderToStaticMarkup(
      <BackrestSummaryCard repos={[failed]} serviceUrl="https://backup.test.local" now={NOW} />,
    );

    expect(html).toContain("ERROR");
    expect(html).toContain("bg-destructive");
  });

  it("says so when Backrest has no repository at all", () => {
    const html = renderToStaticMarkup(<BackrestSummaryCard repos={[]} serviceUrl="https://backup.test.local" />);

    expect(html).toContain("No repositories configured.");
  });
});

describe("backrestSummary", () => {
  it("posts an empty body to the Connect method, because a GET answers 404", async () => {
    const called: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      // Cloned: ky hands over the one Request, and reading its body here would consume it.
      called.push(request.clone());

      return Promise.resolve(
        new Response(JSON.stringify({ repoSummaries: [healthy] }), {
          headers: { "content-type": "application/json" },
        }),
      );
    });

    const html = renderToStaticMarkup(<>{await backrestSummary(service).Widget()}</>);

    expect(called.map(request => request.url)).toEqual(["http://backrest:9898/v1.Backrest/GetSummaryDashboard"]);
    expect(called[0]?.method).toBe("POST");
    expect(await called[0]?.text()).toBe("{}");
    expect(html).toContain("homelab-b2");
    // The container address is Hangar's to reach; the header links to the public host.
    expect(html).not.toContain("backrest:9898");
  });

  it("degrades to the error card when Backrest is unreachable", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")));

    const html = renderToStaticMarkup(<>{await backrestSummary(service).Widget()}</>);

    expect(html).toContain("unavailable");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    expect(renderToStaticMarkup(<>{backrestSummary(aService()).Skeleton()}</>)).toContain("Backrest");
  });
});
