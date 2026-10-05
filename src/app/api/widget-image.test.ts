import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lives here rather than beside the route: waku turns every file under `src/app/pages/` into a
// route, test files included, which breaks the build.
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), logger: { error: vi.fn() } }));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth", () => ({ getSession: mocks.getSession }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));
// The store, reduced to what resolving a widget's service needs: two Jellyfin widgets, each on its
// own server reached on the container network, with the key the operator put in `.env.global`.
const widgets = vi.hoisted(() => [
  { type: "jellyfin-latest" as const, column: 2 as const, url: "http://jellyfin:8096", user: "thomas" },
  { type: "jellyfin-latest" as const, column: 2 as const, url: "http://jellyfin-kids:8096", user: "kids" },
]);

vi.mock("#libs/hangar/server", () => ({
  hangar: {
    store: {
      config: { widgets: () => widgets },
      app: () => undefined,
      env: { appVar: () => Promise.resolve("s3cret") },
    },
  },
}));

const { GET } = await import("#app/pages/_api/api/widgets/[widget]/image/[id].ts");
const { WidgetKey } = await import("#modules/widgets/config/config.ts");

const [adults, kids] = WidgetKey.all(widgets) as [string, string];

const get = (widget: string, id: string) =>
  GET(new Request("http://hangar.test/"), { params: { widget, id } } as never);

describe("GET a relayed widget image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "u-1" } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fetches the image where Hangar can reach it, and keeps the key off the page", async () => {
    const called: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request);

      return Promise.resolve(new Response("jpeg-bytes", { headers: { "content-type": "image/webp" } }));
    });

    const response = await get(adults, "m-1");

    expect(called.map(request => request.url)).toEqual(["http://jellyfin:8096/Items/m-1/Images/Primary"]);
    expect(called[0]?.headers.get("authorization")).toBe('MediaBrowser Token="s3cret"');
    expect(await response.text()).toBe("jpeg-bytes");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("asks the server of the placement the image belongs to, not the first of its type", async () => {
    const called: string[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request.url);

      return Promise.resolve(new Response("jpeg-bytes"));
    });

    await get(kids, "m-2");

    expect(called).toEqual(["http://jellyfin-kids:8096/Items/m-2/Images/Primary"]);
  });

  it("turns an anonymous request away before asking the service anything", async () => {
    mocks.getSession.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn());

    expect((await get(adults, "m-1")).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("relays nothing for a widget without images, one the store never placed, or a steered id", async () => {
    vi.stubGlobal("fetch", vi.fn());

    expect((await get("clock", "m-1")).status).toBe(404);
    expect((await get("frigate-events", "1699999880.0-person")).status).toBe(404);
    // The bare type no longer names a placement: two may share it.
    expect((await get("jellyfin-latest", "m-1")).status).toBe(404);
    expect((await get(adults, "../../System/Info")).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
