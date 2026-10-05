import { describe, expect, it, vi } from "vitest";
import { WidgetKey, WidgetService, widgetConfigSchema, type WidgetConfig } from "./config.ts";
import { noSecret } from "../mock/mock.ts";

const DOMAIN = "test.local";

/** The two URLs, without the key thunk that never compares equal. */
const pick = ({ api, link }: { api: string; link: string }) => ({ api, link });

describe("WidgetService.resolve", () => {
  it("reaches a service on its public host when the store declares neither URL", () => {
    expect(pick(WidgetService.resolve({}, "frigate", DOMAIN, noSecret))).toEqual({
      api: "https://frigate.test.local",
      link: "https://frigate.test.local",
    });
  });

  it("calls the container directly while still linking to the public host", () => {
    expect(pick(WidgetService.resolve({ url: "http://frigate:5000" }, "frigate", DOMAIN, noSecret))).toEqual({
      api: "http://frigate:5000",
      link: "https://frigate.test.local",
    });
  });

  it("follows an overridden link with the API when no URL is declared", () => {
    // The override is there because the default host is wrong, so falling back
    // to that default for the API would send every call somewhere unreachable.
    expect(pick(WidgetService.resolve({ link: "https://cams.example.com" }, "frigate", DOMAIN, noSecret))).toEqual({
      api: "https://cams.example.com",
      link: "https://cams.example.com",
    });
  });

  it("keeps the two apart when both are declared", () => {
    expect(
      pick(
        WidgetService.resolve(
          { url: "http://frigate:5000", link: "https://cams.example.com" },
          "frigate",
          DOMAIN,
          noSecret,
        ),
      ),
    ).toEqual({
      api: "http://frigate:5000",
      link: "https://cams.example.com",
    });
  });

  it("asks for the container's key, and only when the widget wants it", async () => {
    const secret = vi.fn(() => Promise.resolve("s3cret"));
    const { apiKey } = WidgetService.resolve({}, "arcane", DOMAIN, secret);

    expect(secret).not.toHaveBeenCalled();
    await expect(apiKey()).resolves.toBe("s3cret");
    // How that name is spelled in .env.global is HangarEnv's business, not this module's.
    expect(secret).toHaveBeenCalledWith("arcane");
  });

  it("reports an unset key as no key, which is a service that takes none", async () => {
    const { apiKey } = WidgetService.resolve({}, "frigate", DOMAIN, noSecret);

    await expect(apiKey()).resolves.toBeUndefined();
  });

  it("names the link after the container, not the app", () => {
    expect(WidgetService.resolve({}, "frigate-nvr", DOMAIN, noSecret).link).toBe("https://frigate-nvr.test.local");
  });
});

describe("widgetConfigSchema", () => {
  it("accepts a service widget carrying both URLs", () => {
    const parsed = widgetConfigSchema.safeParse({
      type: "frigate-events",
      column: 3,
      url: "http://frigate:5000",
      link: "https://cams.example.com",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a host with no scheme, which ky cannot use as a base URL", () => {
    const parsed = widgetConfigSchema.safeParse({ type: "frigate-events", column: 3, url: "frigate:5000" });

    expect(parsed.success).toBe(false);
  });

  it("takes a cache TTL in whole seconds", () => {
    const parsed = widgetConfigSchema.safeParse({ type: "frigate-events", column: 3, ttl: 15 });

    expect(parsed.success && parsed.data).toMatchObject({ ttl: 15 });
  });

  it("still accepts the Docker widget's former TTL, and drops it", () => {
    const parsed = widgetConfigSchema.safeParse({ type: "docker-general-stats", column: 1, ttl: 15 });

    expect(parsed.success && parsed.data).toEqual({ type: "docker-general-stats", column: 1 });
  });

  it.each([0, -1, 1.5, "15"])("rejects %o as a TTL", value => {
    expect(widgetConfigSchema.safeParse({ type: "frigate-events", column: 3, ttl: value }).success).toBe(false);
  });
});

describe("WidgetKey", () => {
  const glance: WidgetConfig = { type: "github-releases", column: 1, repositories: ["glanceapp/glance"] };
  const waku: WidgetConfig = { type: "github-releases", column: 1, repositories: ["wakujs/waku"] };

  it("tells two placements of one type apart by what they ask for", () => {
    const [first, second] = WidgetKey.all([glance, waku]);

    expect(first).toMatch(/^github-releases-\w+$/);
    expect(second).not.toBe(first);
  });

  it("keeps a placement's key when hangar.yml is reordered or the card changes column", () => {
    const [glanceKey] = WidgetKey.all([glance, waku]);

    expect(WidgetKey.all([waku, { ...glance, column: 3 }])[1]).toBe(glanceKey);
  });

  it("gives a placement asking for another TTL its own key", () => {
    const [first, second] = WidgetKey.all([glance, { ...glance, ttl: 600 }]);

    // Not a suffixed duplicate: its own hash, so it never reads the entry the other TTL bound.
    expect(second).not.toMatch(new RegExp(`^${first}`));
  });

  it("suffixes an identical declaration, since a React key must be unique", () => {
    const [first, second] = WidgetKey.all([glance, glance]);

    expect(second).toBe(`${first}-2`);
  });

  it("finds the declaration a key names, and nothing for one it never handed out", () => {
    const configs = [glance, waku];

    expect(WidgetKey.find(configs, WidgetKey.all(configs)[1]!)).toBe(waku);
    expect(WidgetKey.find(configs, "github-releases")).toBeUndefined();
  });
});
