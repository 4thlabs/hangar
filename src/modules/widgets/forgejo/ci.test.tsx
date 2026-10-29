import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "#libs/logs";
import { aService, aWidget } from "../mock/mock.ts";
import type { ForgejoRepository, ForgejoRun, ForgejoRunStatus } from "./api/client.ts";
import { ForgejoCi, forgejoCi, ForgejoCiCard, type ForgejoCiSummary } from "./ci.tsx";
import { forgejoCiDescriptor } from "./descriptor.ts";

/** Go's zero time, what Forgejo sends for a moment that has not happened. */
const NEVER = "0001-01-01T00:00:00Z";

const NOW = Date.parse("2026-10-28T12:00:00Z");

const aRun = (
  id: number,
  status: ForgejoRunStatus,
  created: string,
  overrides: Partial<ForgejoRun> = {},
): ForgejoRun => ({
  id,
  title: `Commit ${id}`,
  status,
  workflow_id: "ci.yml",
  prettyref: "main",
  html_url: `https://forgejo.example.com/thomas/app/actions/runs/${id}`,
  created,
  started: created,
  stopped: NEVER,
  repository: { full_name: "thomas/app" },
  ...overrides,
});

const aRepository = (full_name: string, overrides: Partial<ForgejoRepository> = {}): ForgejoRepository => ({
  full_name,
  html_url: `https://forgejo.example.com/${full_name}`,
  updated_at: "2026-10-28T10:00:00Z",
  archived: false,
  empty: false,
  has_actions: true,
  ...overrides,
});

/**
 * Answers the repository search with `repositories`, an owner's listing with theirs, and each repository's runs from
 * `runs`; 500 for anything else.
 */
function forgejo(repositories: ForgejoRepository[], runs: Record<string, ForgejoRun[]>) {
  return vi.fn((request: Request) => {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/v1/repos/search") {
      return Promise.resolve(Response.json({ data: repositories }));
    }

    const owner = pathname.match(/^\/api\/v1\/users\/([^/]+)\/repos$/)?.[1];

    if (owner !== undefined) {
      const owned = repositories.filter(repository => repository.full_name.startsWith(`${owner}/`));

      return Promise.resolve(owned.length === 0 ? new Response("Not Found", { status: 404 }) : Response.json(owned));
    }

    const repository = pathname.match(/^\/api\/v1\/repos\/(.+)\/actions\/runs$/)?.[1] ?? "";
    const found = runs[repository];

    if (found === undefined) {
      return Promise.resolve(new Response("Internal Server Error", { status: 500 }));
    }

    return Promise.resolve(Response.json({ workflow_runs: found }));
  });
}

/** The widget's loader, which `forgejoCi` always has. */
function loadOf(body: ReturnType<typeof forgejoCi>) {
  if (!("load" in body)) {
    throw new Error("The Forgejo widget loads its data");
  }

  return body.load;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ForgejoCi.summarize", () => {
  it("lists running runs first, then queued ones, newest first within each", () => {
    const summary = ForgejoCi.summarize(
      [],
      [
        aRun(1, "waiting", "2026-10-28T11:00:00+02:00"),
        aRun(2, "running", "2026-10-28T08:00:00Z"),
        // Later than run 1 despite the earlier wall clock: compared as moments, not as strings.
        aRun(3, "blocked", "2026-10-28T10:30:00+00:00"),
        aRun(4, "running", "2026-10-28T09:00:00Z"),
      ],
    );

    expect(summary.activeRuns.map(run => run.id)).toEqual([4, 2, 3, 1]);
  });

  it("keeps the three repositories updated last, leaving archived ones out", () => {
    const summary = ForgejoCi.summarize(
      [
        aRepository("thomas/a", { updated_at: "2026-10-20T10:00:00Z" }),
        aRepository("thomas/archived", { updated_at: "2026-10-28T10:00:00Z", archived: true }),
        aRepository("thomas/b", { updated_at: "2026-10-27T10:00:00Z" }),
        aRepository("thomas/c", { updated_at: "2026-10-10T10:00:00Z" }),
        aRepository("thomas/d", { updated_at: "2026-10-25T10:00:00Z" }),
      ],
      [],
    );

    expect(summary.repositoryCount).toBe(5);
    expect(summary.recentRepositories.map(repository => repository.full_name)).toEqual([
      "thomas/b",
      "thomas/d",
      "thomas/a",
    ]);
  });
});

describe("ForgejoCi.moment", () => {
  it("dates a running run by when it started", () => {
    const run = aRun(1, "running", "2026-10-28T10:00:00Z", { started: "2026-10-28T10:05:00Z" });

    expect(ForgejoCi.moment(run)).toBe(Date.parse("2026-10-28T10:05:00Z"));
  });

  it("dates a run that has not started by when it was queued", () => {
    const run = aRun(1, "waiting", "2026-10-28T10:00:00Z", { started: NEVER });

    expect(ForgejoCi.moment(run)).toBe(Date.parse("2026-10-28T10:00:00Z"));
  });
});

describe("ForgejoCiCard", () => {
  const summary: ForgejoCiSummary = {
    repositoryCount: 18,
    activeRuns: [
      aRun(5, "running", "2026-10-28T11:58:00Z", { title: "Fix the build" }),
      aRun(4, "waiting", "2026-10-28T11:59:00Z", { prettyref: "#2", started: NEVER }),
    ],
    recentRepositories: [aRepository("thomas/crypto-forecast")],
  };

  it("renders the repository count, what runs, what waits and what was updated last", () => {
    const html = renderToStaticMarkup(
      <ForgejoCiCard summary={summary} serviceUrl="https://forgejo.example.com" now={NOW} />,
    );

    expect(html).toContain("18 repos");
    expect(html).toContain("1 running");
    expect(html).toContain("1 queued");
    expect(html).toContain("Fix the build");
    expect(html).toContain('href="https://forgejo.example.com/thomas/app/actions/runs/5"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("Recently updated");
    expect(html).toContain('href="https://forgejo.example.com/thomas/crypto-forecast"');
  });

  it("says so when nothing is running", () => {
    const html = renderToStaticMarkup(
      <ForgejoCiCard summary={{ ...summary, activeRuns: [] }} serviceUrl="" now={NOW} />,
    );

    expect(html).toContain("Nothing running.");
    expect(html).not.toContain("running</span>");
    expect(html).not.toContain("queued");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    const { Skeleton } = aWidget(forgejoCiDescriptor, forgejoCi(aService()));
    const html = renderToStaticMarkup(<Skeleton />);

    expect(html).toContain("Forgejo");
    expect(html).toContain('aria-busy="true"');
  });
});

describe("forgejoCi", () => {
  it("asks only the repositories that can run Actions for their active runs, with the token", async () => {
    const fetch = forgejo(
      [
        aRepository("thomas/app"),
        aRepository("thomas/old", { archived: true }),
        aRepository("thomas/docs", { has_actions: false }),
      ],
      { "thomas/app": [aRun(1, "running", "2026-10-28T10:00:00Z")] },
    );

    vi.stubGlobal("fetch", fetch);

    const summary = await loadOf(forgejoCi(aService({ apiKey: () => Promise.resolve("secret") })))();
    const requests = fetch.mock.calls.map(([request]) => new URL(request.url));

    expect(summary.repositoryCount).toBe(3);
    expect(summary.activeRuns).toHaveLength(1);
    expect(requests.map(url => url.pathname)).toEqual([
      "/api/v1/repos/search",
      "/api/v1/repos/thomas/app/actions/runs",
    ]);

    expect(requests[1]?.searchParams.getAll("status")).toEqual(["running", "waiting", "blocked"]);
    expect(requests[1]?.searchParams.get("page")).toBe("1");
    expect(fetch.mock.calls[0]?.[0].headers.get("Authorization")).toBe("token secret");
  });

  it("skips a repository whose runs cannot be listed instead of failing the card", async () => {
    vi.stubGlobal(
      "fetch",
      forgejo([aRepository("thomas/app"), aRepository("thomas/broken")], {
        "thomas/app": [aRun(1, "running", "2026-10-28T10:00:00Z")],
      }),
    );

    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    const summary = await loadOf(forgejoCi(aService()))();

    expect(summary.activeRuns).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      "Skipping part of the Forgejo card",
      expect.objectContaining({ repository: "thomas/broken" }),
    );
  });

  it("fails when no repository's runs can be listed", async () => {
    vi.stubGlobal("fetch", forgejo([aRepository("thomas/broken")], {}));
    vi.spyOn(logger, "warn").mockImplementation(() => logger);

    await expect(loadOf(forgejoCi(aService()))()).rejects.toThrow("none of the requests");
  });

  it("covers only the listed owners' repositories, skipping an owner it cannot see", async () => {
    const fetch = forgejo([aRepository("thomas/app"), aRepository("4thlabs/skills"), aRepository("someone/else")], {
      "thomas/app": [],
      "4thlabs/skills": [],
    });

    vi.stubGlobal("fetch", fetch);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    const summary = await loadOf(forgejoCi(aService(), ["thomas", "4thlabs", "private-org"]))();
    const paths = fetch.mock.calls.map(([request]) => new URL(request.url).pathname);

    expect(summary.repositoryCount).toBe(2);
    expect(paths).not.toContain("/api/v1/repos/search");
    expect(paths).not.toContain("/api/v1/repos/someone/else/actions/runs");
    expect(warn).toHaveBeenCalledWith(
      "Skipping part of the Forgejo card",
      expect.objectContaining({ owner: "private-org" }),
    );
  });
});

describe("forgejoCiDescriptor", () => {
  it("takes a list of user and organization names", () => {
    const declaration = { type: "forgejo-ci", column: 2 } as const;

    expect(forgejoCiDescriptor.schema.safeParse({ ...declaration, owners: ["thomas", "4thlabs"] }).success).toBe(true);
    expect(forgejoCiDescriptor.schema.safeParse(declaration).success).toBe(true);
    expect(forgejoCiDescriptor.schema.safeParse({ ...declaration, owners: [] }).success).toBe(false);
    expect(forgejoCiDescriptor.schema.safeParse({ ...declaration, owners: ["thomas/app"] }).success).toBe(false);
  });
});
