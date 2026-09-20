import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lives here rather than beside the route: waku turns every file under `src/app/pages/` into a
// route, test files included, which breaks the build.
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), logger: { error: vi.fn() } }));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth", () => ({ getSession: mocks.getSession }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));
// The store, reduced to what resolving a widget's service needs: one placed Jellyfin widget,
// reached on the container network, with the key the operator put in `.env.global`.
vi.mock("#libs/hangar/server", () => ({
  hangar: {
    store: {
      config: { widgets: () => [{ type: "jellyfin-latest", column: 2, url: "http://jellyfin:8096", user: "thomas" }] },
      app: () => undefined,
      env: { appVar: () => Promise.resolve("s3cret") },
    },
  },
}));

const { GET } = await import("#app/pages/_api/api/widgets/[widget]/image/[id].ts");

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

    const response = await get("jellyfin-latest", "m-1");

    expect(called.map(request => request.url)).toEqual(["http://jellyfin:8096/Items/m-1/Images/Primary"]);
    expect(called[0]?.headers.get("authorization")).toBe('MediaBrowser Token="s3cret"');
    expect(await response.text()).toBe("jpeg-bytes");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("turns an anonymous request away before asking the service anything", async () => {
    mocks.getSession.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn());

    expect((await get("jellyfin-latest", "m-1")).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("relays nothing for a widget without images, one the store never placed, or a steered id", async () => {
    vi.stubGlobal("fetch", vi.fn());

    expect((await get("clock", "m-1")).status).toBe(404);
    expect((await get("frigate-events", "1699999880.0-person")).status).toBe(404);
    expect((await get("jellyfin-latest", "../../System/Info")).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
