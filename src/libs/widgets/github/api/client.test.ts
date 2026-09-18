import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearReleaseCache, getLatestReleases } from "./client.ts";

const release = (tag: string, publishedAt: string) => ({
  tag_name: tag,
  html_url: `https://github.com/example/repo/releases/tag/${tag}`,
  published_at: publishedAt,
});

function respond(byRepository: Record<string, unknown>) {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const found = Object.entries(byRepository).find(([repository]) => url.includes(repository));

    if (!found) return Promise.resolve(new Response("Not Found", { status: 404 }));

    return Promise.resolve(Response.json(found[1]));
  });
}

beforeEach(() => {
  clearReleaseCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getLatestReleases", () => {
  it("returns the latest release of each repository, newest first", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        "immich-app/immich": release("v1.140.0", "2026-09-15T12:00:00Z"),
        "glanceapp/glance": release("v0.8.4", "2026-09-18T10:00:00Z"),
      }),
    );

    const releases = await getLatestReleases(["immich-app/immich", "glanceapp/glance"]);

    expect(releases.map(item => item.repository)).toEqual(["glanceapp/glance", "immich-app/immich"]);
    expect(releases[0]?.tag).toBe("v0.8.4");
  });

  it("drops a repository that has no release instead of failing the widget", async () => {
    vi.stubGlobal("fetch", respond({ "glanceapp/glance": release("v0.8.4", "2026-09-18T10:00:00Z") }));

    const releases = await getLatestReleases(["glanceapp/glance", "example/never-released"]);

    expect(releases.map(item => item.repository)).toEqual(["glanceapp/glance"]);
  });

  it("serves the cached release instead of asking again", async () => {
    const fetcher = respond({ "glanceapp/glance": release("v0.8.4", "2026-09-18T10:00:00Z") });
    vi.stubGlobal("fetch", fetcher);

    await getLatestReleases(["glanceapp/glance"], 1_000);
    await getLatestReleases(["glanceapp/glance"], 1_000 + 29 * 60 * 1_000);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches once the cache went stale", async () => {
    const fetcher = respond({ "glanceapp/glance": release("v0.8.4", "2026-09-18T10:00:00Z") });
    vi.stubGlobal("fetch", fetcher);

    await getLatestReleases(["glanceapp/glance"], 1_000);
    await getLatestReleases(["glanceapp/glance"], 1_000 + 31 * 60 * 1_000);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps serving a stale release when GitHub rate-limits the refresh", async () => {
    vi.stubGlobal("fetch", respond({ "glanceapp/glance": release("v0.8.4", "2026-09-18T10:00:00Z") }));
    await getLatestReleases(["glanceapp/glance"], 1_000);

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("rate limited", { status: 403 }))),
    );
    const releases = await getLatestReleases(["glanceapp/glance"], 1_000 + 31 * 60 * 1_000);

    expect(releases[0]?.tag).toBe("v0.8.4");
  });
});
