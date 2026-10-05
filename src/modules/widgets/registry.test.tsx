import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The registry pulls in the Docker widget, and through it the server-only client.
vi.mock("server-only", () => ({}));

import { WidgetRegistry } from "./registry.ts";
import { defaultWidgets, widgetConfigSchema } from "./config/config.ts";
import { clearWidgetCache, noSecret } from "./mock/mock.ts";
import { githubClient } from "./github/api/client.ts";

const host = { domain: "test.local", containerName: (app: string) => app, secret: noSecret };

describe("WidgetRegistry", () => {
  beforeEach(clearWidgetCache);

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

  it("gives two placements of one type their own cache entry", async () => {
    const load = vi
      .spyOn(githubClient, "getLatestReleases")
      .mockImplementation(repositories =>
        Promise.resolve(
          repositories.map(repository => ({ repository, tag: "v1", url: "", publishedAt: "2026-01-01" })),
        ),
      );
    const [glance, waku] = new WidgetRegistry(host).resolve([
      { type: "github-releases", column: 1, repositories: ["glanceapp/glance"] },
      { type: "github-releases", column: 3, repositories: ["wakujs/waku"] },
    ]);

    expect(glance!.widget.key).not.toBe(waku!.widget.key);
    expect(renderToStaticMarkup(<>{await glance!.widget.Widget()}</>)).toContain("glanceapp/glance");
    expect(renderToStaticMarkup(<>{await waku!.widget.Widget()}</>)).toContain("wakujs/waku");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("resolves the dashboard a store gets when it declares no widgets", () => {
    expect(new WidgetRegistry(host).resolve(defaultWidgets)).toHaveLength(defaultWidgets.length);
  });

  it("asks for the container of the app its widget type names", () => {
    const containerName = vi.fn((app: string) => `${app}-1`);

    new WidgetRegistry({ domain: "test.local", containerName, secret: noSecret }).resolve([
      { type: "frigate-events", column: 3 },
    ]);

    expect(containerName).toHaveBeenCalledWith("frigate");
  });

  it("resolves a widget that needs no service without asking for a container", () => {
    const containerName = vi.fn((app: string) => app);

    new WidgetRegistry({ domain: "test.local", containerName, secret: noSecret }).resolve([
      { type: "clock", column: 1 },
    ]);

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
