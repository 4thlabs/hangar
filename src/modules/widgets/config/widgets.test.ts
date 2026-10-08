import { describe, expect, it } from "vitest";
import { widgetConfigSchema, WidgetKey, type WidgetConfig } from "./widgets.ts";

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
  const releases = (repositories: string[], column: 1 | 2 | 3 = 1, ttl?: number): WidgetConfig => ({
    type: "github-releases",
    column,
    repositories,
    ...(ttl === undefined ? {} : { ttl }),
  });

  it("tells two placements of one type apart by what they read", () => {
    const [first, second] = WidgetKey.all([releases(["a/one"]), releases(["b/two"])]);

    expect(first).toMatch(/^github-releases-[0-9a-z]+$/);
    expect(second).toMatch(/^github-releases-[0-9a-z]+$/);
    expect(first).not.toBe(second);
  });

  it("keeps a placement's key when the file is reordered or the card changes column", () => {
    const [key] = WidgetKey.all([releases(["a/one"])]);

    expect(WidgetKey.all([{ type: "clock", column: 1 }, releases(["b/two"]), releases(["a/one"], 3)])[2]).toBe(key);
  });

  it("ignores the order the fields were written in", () => {
    const written = { repositories: ["a/one"], column: 1, type: "github-releases" } as WidgetConfig;

    expect(WidgetKey.all([written])).toEqual(WidgetKey.all([releases(["a/one"])]));
  });

  it("gives a new key to a placement that reads something else", () => {
    const [before] = WidgetKey.all([releases(["a/one"])]);
    const [after] = WidgetKey.all([releases(["a/one"], 1, 300)]);

    expect(after).not.toBe(before);
  });

  it("suffixes a declaration repeated verbatim, in declaration order", () => {
    const [first, second, third] = WidgetKey.all([releases(["a/one"]), releases(["a/one"]), releases(["a/one"])]);

    expect(second).toBe(`${first}-2`);
    expect(third).toBe(`${first}-3`);
  });

  it("finds the declaration a key names, and nothing for a key it never handed out", () => {
    const configs = [releases(["a/one"]), releases(["b/two"])];
    const [, key] = WidgetKey.all(configs);

    expect(WidgetKey.find(configs, key!)).toBe(configs[1]);
    expect(WidgetKey.find(configs, "github-releases")).toBeUndefined();
  });
});
