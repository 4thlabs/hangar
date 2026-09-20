import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JellyfinItem } from "./api/client.ts";
import { JellyfinLatestCard, displayItem, jellyfinLatest } from "./latest.tsx";
import { aService } from "../mock/mock.ts";

afterEach(() => vi.unstubAllGlobals());

const service = {
  api: "http://jellyfin:8096",
  link: "https://jellyfin.test.local",
  apiKey: () => Promise.resolve("s3cret"),
};

describe("displayItem", () => {
  it("shows an episode as its series, so ten stills of one show become one poster", () => {
    const episode: JellyfinItem = {
      Id: "ep-1",
      Name: "Chapter One",
      Type: "Episode",
      SeriesId: "series-9",
      SeriesName: "Severance",
    };

    expect(displayItem(episode)).toEqual({ id: "series-9", title: "Severance", subtitle: undefined });
  });

  it("falls back to the episode itself when Jellyfin reports no series", () => {
    expect(displayItem({ Id: "ep-1", Name: "Chapter One", Type: "Episode" })).toMatchObject({
      id: "ep-1",
      title: "Chapter One",
    });
  });

  it("credits an album to its artist and a movie to its year", () => {
    expect(displayItem({ Id: "a", Name: "Rumours", Type: "MusicAlbum", AlbumArtist: "Fleetwood Mac" }).subtitle).toBe(
      "Fleetwood Mac",
    );
    expect(displayItem({ Id: "m", Name: "Dune", Type: "Movie", ProductionYear: 2021 }).subtitle).toBe("2021");
  });
});

describe("JellyfinLatestCard", () => {
  const items = [{ id: "series-9", title: "Severance", subtitle: undefined }];

  it("relays posters through Hangar and links the visitor to Jellyfin", () => {
    const html = renderToStaticMarkup(<JellyfinLatestCard items={items} serviceUrl="https://jellyfin.test.local" />);

    expect(html).toContain('src="/api/jellyfin/poster/series-9"');
    expect(html).toContain("https://jellyfin.test.local/web/#/details?id=series-9");
  });

  it("says so when a library has nothing new", () => {
    const html = renderToStaticMarkup(<JellyfinLatestCard items={[]} serviceUrl="https://jellyfin.test.local" />);

    expect(html).toContain("No items found.");
  });
});

describe("jellyfinLatest", () => {
  const stub = (users: unknown, latest: unknown) => {
    const called: string[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request.url);
      const body = request.url.includes("/Items/Latest") ? latest : users;

      return Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
    });

    return called;
  };

  it("turns the configured user name into the id the API wants, and never leaks the key", async () => {
    const called = stub(
      [
        { Id: "u-1", Name: "someone-else" },
        { Id: "u-2", Name: "thomas" },
      ],
      [{ Id: "m-1", Name: "Dune", Type: "Movie", ProductionYear: 2021 }],
    );

    const html = renderToStaticMarkup(<>{await jellyfinLatest(service, "thomas").Widget()}</>);

    expect(called).toEqual([
      "http://jellyfin:8096/Users",
      "http://jellyfin:8096/Items/Latest?userId=u-2&limit=10&includeItemTypes=Movie%2CEpisode%2CMusicAlbum&groupItems=true",
    ]);
    // The whole reason the poster is proxied: the key must not reach the page.
    expect(html).not.toContain("s3cret");
    expect(html).toContain("/api/jellyfin/poster/m-1");
  });

  it("degrades to the error card when the configured user does not exist", async () => {
    stub([{ Id: "u-1", Name: "someone-else" }], []);

    const html = renderToStaticMarkup(<>{await jellyfinLatest(service, "thomas").Widget()}</>);

    expect(html).toContain("unavailable");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    expect(renderToStaticMarkup(<>{jellyfinLatest(aService(), "thomas").Skeleton()}</>)).toContain("Latest additions");
  });
});
