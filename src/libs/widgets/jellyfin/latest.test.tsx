import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearWidgetCache } from "../mock/index.ts";
import type { JellyfinItem } from "./api/client.ts";
import { JellyfinLatestCard, displayItem, jellyfinLatest } from "./latest.tsx";
import { aService } from "../mock/mock.ts";

afterEach(() => vi.unstubAllGlobals());

const service = {
  api: "http://jellyfin:8096",
  link: "https://jellyfin.test.local",
  apiKey: () => Promise.resolve("s3cret"),
};

beforeEach(clearWidgetCache);

describe("displayItem", () => {
  it("shows an episode as its series, so ten stills of one show become one poster", () => {
    const episode: JellyfinItem = {
      Id: "ep-1",
      Name: "Chapter One",
      Type: "Episode",
      SeriesId: "series-9",
      SeriesName: "Severance",
      ImageTags: { Primary: "tag" },
    };

    expect(displayItem(episode)).toEqual({
      id: "series-9",
      imageId: "ep-1",
      title: "Severance",
      subtitle: undefined,
    });
  });

  it("falls back to the episode itself when Jellyfin reports no series", () => {
    expect(displayItem({ Id: "ep-1", Name: "Chapter One", Type: "Episode" })).toMatchObject({
      id: "ep-1",
      title: "Chapter One",
    });
  });

  it("asks for no poster when the item has none, and borrows the parent's when it has one", () => {
    // A series Jellyfin never found art for: asking anyway is a 404 and a broken image.
    expect(displayItem({ Id: "s-1", Name: "Drifters", Type: "Series", ImageTags: {} }).imageId).toBeUndefined();
    expect(
      displayItem({ Id: "a-1", Name: "Rumours", Type: "MusicAlbum", ParentPrimaryImageItemId: "artist-3" }).imageId,
    ).toBe("artist-3");
  });

  it("credits an album to its artist and a movie to its year", () => {
    expect(displayItem({ Id: "a", Name: "Rumours", Type: "MusicAlbum", AlbumArtist: "Fleetwood Mac" }).subtitle).toBe(
      "Fleetwood Mac",
    );
    expect(displayItem({ Id: "m", Name: "Dune", Type: "Movie", ProductionYear: 2021 }).subtitle).toBe("2021");
  });
});

describe("JellyfinLatestCard", () => {
  const items = [{ id: "series-9", imageId: "ep-1", title: "Severance", subtitle: undefined }];

  it("relays posters through Hangar and links the visitor to Jellyfin", () => {
    const html = renderToStaticMarkup(<JellyfinLatestCard items={items} serviceUrl="https://jellyfin.test.local" />);

    expect(html).toContain('src="/api/widgets/jellyfin-latest/image/ep-1"');
    expect(html).toContain("https://jellyfin.test.local/web/#/details?id=series-9");
  });

  it("keeps the frame, without an <img>, for an item Jellyfin has no art for", () => {
    const html = renderToStaticMarkup(
      <JellyfinLatestCard
        items={[{ id: "s-1", imageId: undefined, title: "Drifters", subtitle: undefined }]}
        serviceUrl="https://jellyfin.test.local"
      />,
    );

    expect(html).toContain("Drifters");
    // The widget icon is an <img> of its own, so it is the relay that must not be asked.
    expect(html).not.toContain("/api/widgets/jellyfin-latest/image/");
  });

  it("says so when a library has nothing new", () => {
    const html = renderToStaticMarkup(<JellyfinLatestCard items={[]} serviceUrl="https://jellyfin.test.local" />);

    expect(html).toContain("No items found.");
  });
});

describe("jellyfinLatest", () => {
  /** How many posters the rendered row holds; every cell is one `snap-start` list item. */
  const cells = (html: string) => html.split("snap-start").length - 1;

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
      [{ Id: "m-1", Name: "Dune", Type: "Movie", ProductionYear: 2021, ImageTags: { Primary: "tag" } }],
    );

    const html = renderToStaticMarkup(<>{await jellyfinLatest(service, "thomas").Widget()}</>);

    expect(called).toEqual([
      "http://jellyfin:8096/Users",
      "http://jellyfin:8096/Items/Latest?userId=u-2&limit=100&includeItemTypes=Movie%2CEpisode%2CMusicAlbum&groupItems=true&enableImageTypes=Primary",
    ]);
    // The whole reason the poster is proxied: the key must not reach the page.
    expect(html).not.toContain("s3cret");
    expect(html).toContain("/api/widgets/jellyfin-latest/image/m-1");
  });

  it("fills the row from an over-fetched list, because Jellyfin groups after it cuts", async () => {
    // The bug this widget shipped with: the limit was the row length, so a run of episodes from
    // one series grouped down to a single cell. Asking for ten times as many is what leaves
    // enough behind, and the trimming happens here.
    const many = Array.from({ length: 25 }, (_, index) => ({
      Id: `m-${index}`,
      Name: `Film ${index}`,
      Type: "Movie",
      ImageTags: { Primary: "tag" },
    }));
    stub([{ Id: "u-2", Name: "thomas" }], many);

    const html = renderToStaticMarkup(<>{await jellyfinLatest(service, "thomas").Widget()}</>);

    expect(cells(html)).toBe(10);
    expect(html).toContain("Film 0");
    expect(html).not.toContain("Film 10");
  });

  it("counts two episodes of one series once, so the row keys stay unique", async () => {
    const episode = (Id: string) => ({ Id, Name: Id, Type: "Episode", SeriesId: "s-1", SeriesName: "Severance" });
    stub([{ Id: "u-2", Name: "thomas" }], [episode("ep-1"), episode("ep-2")]);

    const html = renderToStaticMarkup(<>{await jellyfinLatest(service, "thomas").Widget()}</>);

    expect(cells(html)).toBe(1);
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
