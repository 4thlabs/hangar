import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearWidgetCache } from "../mock/index.ts";
import { aService, aWidget } from "../mock/mock.ts";
import type { JellyfinCounts, JellyfinItem } from "./api/client.ts";
import { jellyfinLatestDescriptor } from "./descriptor.ts";
import { jellyfinLatest, JellyfinLatestCard, JellyfinPoster } from "./latest.tsx";

afterEach(() => vi.unstubAllGlobals());

const service = {
  api: "http://jellyfin:8096",
  link: "https://jellyfin.test.local",
  apiKey: () => Promise.resolve("s3cret"),
};

beforeEach(clearWidgetCache);

const counts: JellyfinCounts = { MovieCount: 1284, SeriesCount: 97, EpisodeCount: 4512, SongCount: 8903 };

describe("JellyfinPoster.display", () => {
  it("shows an episode as its series, so ten stills of one show become one poster", () => {
    const episode: JellyfinItem = {
      Id: "ep-1",
      Name: "Chapter One",
      Type: "Episode",
      SeriesId: "series-9",
      SeriesName: "Severance",
      ImageTags: { Primary: "tag" },
    };

    expect(JellyfinPoster.display(episode)).toEqual({
      id: "series-9",
      imageId: "ep-1",
      title: "Severance",
      subtitle: undefined,
    });
  });

  it("falls back to the episode itself when Jellyfin reports no series", () => {
    expect(JellyfinPoster.display({ Id: "ep-1", Name: "Chapter One", Type: "Episode" })).toMatchObject({
      id: "ep-1",
      title: "Chapter One",
    });
  });

  it("asks for no poster when the item has none, and borrows the parent's when it has one", () => {
    // A series Jellyfin never found art for: asking anyway is a 404 and a broken image.
    expect(
      JellyfinPoster.display({ Id: "s-1", Name: "Drifters", Type: "Series", ImageTags: {} }).imageId,
    ).toBeUndefined();

    expect(
      JellyfinPoster.display({ Id: "a-1", Name: "Rumours", Type: "MusicAlbum", ParentPrimaryImageItemId: "artist-3" })
        .imageId,
    ).toBe("artist-3");
  });

  it("credits an album to its artist and a movie to its year", () => {
    expect(
      JellyfinPoster.display({ Id: "a", Name: "Rumours", Type: "MusicAlbum", AlbumArtist: "Fleetwood Mac" }).subtitle,
    ).toBe("Fleetwood Mac");

    expect(JellyfinPoster.display({ Id: "m", Name: "Dune", Type: "Movie", ProductionYear: 2021 }).subtitle).toBe(
      "2021",
    );
  });
});

describe("JellyfinLatestCard", () => {
  const items = [{ id: "series-9", imageId: "ep-1", title: "Severance", subtitle: undefined }];

  it("relays posters through Hangar and links the visitor to Jellyfin", () => {
    const html = renderToStaticMarkup(
      <JellyfinLatestCard
        counts={counts}
        items={items}
        serviceUrl="https://jellyfin.test.local"
        placementKey="jellyfin-latest-k1"
      />,
    );

    expect(html).toContain('src="/api/widgets/jellyfin-latest-k1/image/ep-1"');
    expect(html).toContain("https://jellyfin.test.local/web/#/details?id=series-9");
  });

  it("reads the library totals as a subtitle rather than a card of their own", () => {
    const html = renderToStaticMarkup(
      <JellyfinLatestCard
        counts={counts}
        items={items}
        serviceUrl="https://jellyfin.test.local"
        placementKey="jellyfin-latest-k1"
      />,
    );

    expect(html).toContain("1,284 movies");
    expect(html).toContain("97 shows");
    expect(html).toContain("4,512 episodes");
    expect(html).toContain("8,903 songs");
  });

  it("keeps the frame, without an <img>, for an item Jellyfin has no art for", () => {
    const html = renderToStaticMarkup(
      <JellyfinLatestCard
        counts={counts}
        items={[{ id: "s-1", imageId: undefined, title: "Drifters", subtitle: undefined }]}
        serviceUrl="https://jellyfin.test.local"
        placementKey="jellyfin-latest-k1"
      />,
    );

    expect(html).toContain("Drifters");
    // The widget icon is an <img> of its own, so it is the relay that must not be asked.
    expect(html).not.toContain("/api/widgets/jellyfin-latest-k1/image/");
  });

  it("says so when a library has nothing new", () => {
    const html = renderToStaticMarkup(
      <JellyfinLatestCard
        counts={counts}
        items={[]}
        serviceUrl="https://jellyfin.test.local"
        placementKey="jellyfin-latest-k1"
      />,
    );

    expect(html).toContain("No items found.");
  });
});

describe("jellyfinLatest", () => {
  /** How many posters the rendered row holds; every cell is one `snap-start` list item. */
  const cells = (html: string) => html.split("snap-start").length - 1;

  const stub = (users: unknown, latest: unknown) => {
    const called: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request);
      const body = request.url.includes("/Items/Counts")
        ? counts
        : request.url.includes("/Items/Latest")
          ? latest
          : users;

      return Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
    });

    return called;
  };

  /** The URLs the widget asked for, in order. */
  const urls = (called: Request[]) => called.map(request => request.url);

  it("turns the configured user name into the id the API wants, and never leaks the key", async () => {
    const called = stub(
      [
        { Id: "u-1", Name: "someone-else" },
        { Id: "u-2", Name: "thomas" },
      ],
      [{ Id: "m-1", Name: "Dune", Type: "Movie", ProductionYear: 2021, ImageTags: { Primary: "tag" } }],
    );

    const html = renderToStaticMarkup(
      <>{await aWidget(jellyfinLatestDescriptor, jellyfinLatest(service, "thomas")).Widget()}</>,
    );

    expect(urls(called)).toEqual([
      "http://jellyfin:8096/Items/Counts",
      "http://jellyfin:8096/Users",
      "http://jellyfin:8096/Items/Latest?userId=u-2&limit=100&includeItemTypes=Movie%2CEpisode%2CMusicAlbum&groupItems=true&enableImageTypes=Primary",
    ]);

    // The whole reason the poster is proxied: the key must not reach the page.
    expect(html).not.toContain("s3cret");
    expect(html).toContain("/api/widgets/test-widget/image/m-1");
  });

  it("fills the row from an over-fetched list, because Jellyfin groups after it cuts", async () => {
    // Asking for the row length alone would group a run of episodes from one series down to one cell.
    const many = Array.from({ length: 25 }, (_, index) => ({
      Id: `m-${index}`,
      Name: `Film ${index}`,
      Type: "Movie",
      ImageTags: { Primary: "tag" },
    }));

    stub([{ Id: "u-2", Name: "thomas" }], many);

    const html = renderToStaticMarkup(
      <>{await aWidget(jellyfinLatestDescriptor, jellyfinLatest(service, "thomas")).Widget()}</>,
    );

    expect(cells(html)).toBe(10);
    expect(html).toContain("Film 0");
    expect(html).not.toContain("Film 10");
  });

  it("counts two episodes of one series once, so the row keys stay unique", async () => {
    const episode = (Id: string) => ({ Id, Name: Id, Type: "Episode", SeriesId: "s-1", SeriesName: "Severance" });

    stub([{ Id: "u-2", Name: "thomas" }], [episode("ep-1"), episode("ep-2")]);

    const html = renderToStaticMarkup(
      <>{await aWidget(jellyfinLatestDescriptor, jellyfinLatest(service, "thomas")).Widget()}</>,
    );

    expect(cells(html)).toBe(1);
  });

  it("degrades to the error card when the configured user does not exist", async () => {
    stub([{ Id: "u-1", Name: "someone-else" }], []);

    const html = renderToStaticMarkup(
      <>{await aWidget(jellyfinLatestDescriptor, jellyfinLatest(service, "thomas")).Widget()}</>,
    );

    expect(html).toContain("unavailable");
  });

  it("calls Jellyfin at the root with a MediaBrowser token, not /api with X-API-Key", async () => {
    // Jellyfin serves its API at the root and takes its key as `Authorization: MediaBrowser
    // Token="..."`; both are easy to get wrong because every other service here does the opposite.
    const called = stub([{ Id: "u-2", Name: "thomas" }], []);

    const html = renderToStaticMarkup(
      <>{await aWidget(jellyfinLatestDescriptor, jellyfinLatest(service, "thomas")).Widget()}</>,
    );

    expect(called[0]?.url).toBe("http://jellyfin:8096/Items/Counts");
    expect(called[0]?.headers.get("authorization")).toBe('MediaBrowser Token="s3cret"');
    expect(called[0]?.headers.get("x-api-key")).toBeNull();
    expect(called[0]?.headers.get("x-emby-token")).toBeNull();
    // The container address is Hangar's to reach, never the visitor's.
    expect(html).not.toContain("jellyfin:8096");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    expect(
      renderToStaticMarkup(<>{aWidget(jellyfinLatestDescriptor, jellyfinLatest(aService(), "thomas")).Skeleton()}</>),
    ).toContain("Jellyfin");
  });
});
