import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lives here rather than beside the route: waku turns every file under `src/app/pages/` into a
// route, test files included, which breaks the build.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  logger: { error: vi.fn() },
  // A clock, and two Jellyfin servers: one type placed twice, each on its own container.
  widgets: [
    { type: "clock", column: 1 },
    { type: "jellyfin-latest", column: 2, url: "http://jellyfin:8096", user: "thomas" },
    { type: "jellyfin-latest", column: 2, url: "http://jellyfin-kids:8096", user: "kids" },
  ] as const,
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth", () => ({ getSession: mocks.getSession }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));
// The store, reduced to what resolving a widget's service needs: the placements above, reached on
// the container network, with the key the operator put in `.env.global`.
vi.mock("#libs/hangar/server", () => ({
  hangar: {
    store: {
      config: { widgets: () => mocks.widgets },
      app: () => undefined,
      env: { appVar: () => Promise.resolve("s3cret") },
    },
  },
}));

const { GET } = await import("#app/pages/_api/api/widgets/[placementKey]/image/[id].ts");
const { WidgetKey } = await import("#modules/widgets/config/config.ts");

const [clock, jellyfin, kids] = WidgetKey.all(mocks.widgets) as [string, string, string];

const get = (placementKey: string, id: string) =>
  GET(new Request("http://hangar.test/"), { params: { placementKey, id } } as never);

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

    const response = await get(jellyfin, "m-1");

    expect(called.map(request => request.url)).toEqual(["http://jellyfin:8096/Items/m-1/Images/Primary"]);
    expect(called[0]?.headers.get("authorization")).toBe('MediaBrowser Token="s3cret"');
    expect(await response.text()).toBe("jpeg-bytes");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("asks the server of the placement the image belongs to, not the first of its type", async () => {
    const called: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request);

      return Promise.resolve(new Response("jpeg-bytes"));
    });

    await get(kids, "m-1");

    expect(called.map(request => request.url)).toEqual(["http://jellyfin-kids:8096/Items/m-1/Images/Primary"]);
  });

  it("turns an anonymous request away before asking the service anything", async () => {
    mocks.getSession.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn());

    expect((await get(jellyfin, "m-1")).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("relays nothing for a widget without images, a key the store never handed out, or a steered id", async () => {
    vi.stubGlobal("fetch", vi.fn());

    expect((await get(clock, "m-1")).status).toBe(404);
    // A bare type names no placement, even when one of that type is placed.
    expect((await get("jellyfin-latest", "m-1")).status).toBe(404);
    expect((await get("frigate-events", "1699999880.0-person")).status).toBe(404);
    expect((await get(jellyfin, "../../System/Info")).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
