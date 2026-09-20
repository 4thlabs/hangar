import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JellyfinCounts } from "./api/client.ts";
import { JellyfinStatsCard, jellyfinStats } from "./stats.tsx";
import { aService } from "../mock/mock.ts";

afterEach(() => vi.unstubAllGlobals());

const counts: JellyfinCounts = { MovieCount: 1284, SeriesCount: 97, EpisodeCount: 4512, SongCount: 8903 };

describe("JellyfinStatsCard", () => {
  it("shows every library total", () => {
    const html = renderToStaticMarkup(<JellyfinStatsCard counts={counts} serviceUrl="https://jellyfin.test.local" />);

    expect(html).toContain("Movies");
    expect(html).toContain("1,284");
    expect(html).toContain("4,512");
    expect(html).toContain("https://jellyfin.test.local");
  });

  it("calls Jellyfin at the root with a MediaBrowser token, not /api with X-API-Key", async () => {
    // Jellyfin serves its API at the root and takes its key as `Authorization: MediaBrowser
    // Token="..."`; both are easy to get wrong because every other service here does the opposite.
    const called: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request);
      return Promise.resolve(new Response(JSON.stringify(counts), { headers: { "content-type": "application/json" } }));
    });

    const { Widget } = jellyfinStats({
      api: "http://jellyfin:8096",
      link: "https://jellyfin.test.local",
      apiKey: () => Promise.resolve("s3cret"),
    });
    const html = renderToStaticMarkup(<>{await Widget()}</>);

    expect(called.map(request => request.url)).toEqual(["http://jellyfin:8096/Items/Counts"]);
    expect(called[0]?.headers.get("authorization")).toBe('MediaBrowser Token="s3cret"');
    expect(called[0]?.headers.get("x-api-key")).toBeNull();
    expect(called[0]?.headers.get("x-emby-token")).toBeNull();
    expect(html).not.toContain("jellyfin:8096");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    const { Skeleton } = jellyfinStats(aService());

    expect(renderToStaticMarkup(<Skeleton />)).toContain("Jellyfin");
  });
});
