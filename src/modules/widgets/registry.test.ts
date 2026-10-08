import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWidgets, widgetConfigSchema } from "./config/widgets.ts";
import { noSecret } from "./mock/mock.ts";
import { WidgetRegistry } from "./registry.ts";

// A widget that fails logs it; the test only cares that the failure stays inside its card.
vi.mock("#libs/logs", () => ({ logger: { error: vi.fn() } }));

afterEach(() => vi.unstubAllGlobals());

const host = { domain: "test.local", containerName: (app: string) => app, secret: noSecret };

describe("WidgetRegistry", () => {
  it("places every declared widget in its column, in order", () => {
    const placements = new WidgetRegistry(host).resolve([
      { type: "clock", column: 1 },
      { type: "github-releases", column: 3, repositories: ["glanceapp/glance"] },
    ]);

    expect(placements.map(placement => [placement.widget.id, placement.column])).toEqual([
      ["clock", 1],
      ["github-releases", 3],
    ]);
  });

  it("binds each placement to its own key, even two of one type", () => {
    const placements = new WidgetRegistry(host).resolve([
      { type: "clock", column: 1 },
      { type: "github-releases", column: 3, repositories: ["glanceapp/glance"] },
      { type: "github-releases", column: 3, repositories: ["4thlabs/hangar"] },
    ]);

    const keys = placements.map(placement => placement.widget.key);

    expect(new Set(keys).size).toBe(3);
    expect(keys.every((key, index) => key.startsWith(`${placements[index]!.widget.id}-`))).toBe(true);
  });

  it("resolves the dashboard a store gets when it declares no widgets", () => {
    expect(new WidgetRegistry(host).resolve(defaultWidgets)).toHaveLength(defaultWidgets.length);
  });

  it("places a widget without importing it or resolving its service", () => {
    const containerName = vi.fn((app: string) => app);

    new WidgetRegistry({ domain: "test.local", containerName, secret: noSecret }).resolve([
      { type: "frigate-events", column: 3 },
    ]);

    expect(containerName).not.toHaveBeenCalled();
  });

  it("asks for the container of the app its descriptor reads once the card loads, and keeps a failure in it", async () => {
    const containerName = vi.fn((app: string) => `${app}-1`);

    vi.stubGlobal("fetch", () => Promise.reject(new Error("unreachable")));

    const [placement] = new WidgetRegistry({ domain: "test.local", containerName, secret: noSecret }).resolve([
      { type: "frigate-events", column: 3 },
    ]);

    const html = renderToStaticMarkup(await placement!.widget.Widget());

    expect(containerName).toHaveBeenCalledWith("frigate");
    expect(html).toContain("Frigate is unavailable");
  });

  it("renders a widget that needs no service without asking for a container", async () => {
    const containerName = vi.fn((app: string) => app);

    const [placement] = new WidgetRegistry({ domain: "test.local", containerName, secret: noSecret }).resolve([
      { type: "clock", column: 1 },
    ]);

    await placement!.widget.Widget();

    expect(containerName).not.toHaveBeenCalled();
  });
});

describe("widgetConfigSchema", () => {
  it("rejects a github-releases widget without repositories", () => {
    const parsed = widgetConfigSchema.safeParse({ type: "github-releases", column: 1, repositories: [] });

    expect(parsed.success).toBe(false);
  });

  it("rejects a repository that is not owner/repo", () => {
    const parsed = widgetConfigSchema.safeParse({ type: "github-releases", column: 1, repositories: ["glance"] });

    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown widget type", () => {
    expect(widgetConfigSchema.safeParse({ type: "relases", column: 1 }).success).toBe(false);
  });
});
