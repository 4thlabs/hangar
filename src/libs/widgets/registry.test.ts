import { describe, expect, it, vi } from "vitest";

// The registry pulls in the Docker widget, and through it the server-only client.
vi.mock("server-only", () => ({}));

import { defaultWidgets, resolveWidgets, widgetConfigSchema } from "./index.ts";
import { noSecret } from "./mock/mock.ts";

const host = { domain: "test.local", containerName: (app: string) => app, secret: noSecret };

describe("resolveWidgets", () => {
  it("places every declared widget in its column, in order", () => {
    const placements = resolveWidgets(
      [
        { type: "clock", column: 1 },
        { type: "github-releases", column: 3, repositories: ["glanceapp/glance"] },
      ],
      host,
    );

    expect(placements.map(placement => [placement.widget.id, placement.column])).toEqual([
      ["clock", 1],
      ["github-releases", 3],
    ]);
  });

  it("resolves the dashboard a store gets when it declares no widgets", () => {
    expect(resolveWidgets(defaultWidgets, host)).toHaveLength(defaultWidgets.length);
  });

  it("asks for the container of the app its widget type names", () => {
    const containerName = vi.fn((app: string) => `${app}-1`);

    resolveWidgets([{ type: "frigate-events", column: 3 }], { domain: "test.local", containerName, secret: noSecret });

    expect(containerName).toHaveBeenCalledWith("frigate");
  });

  it("resolves a widget that needs no service without asking for a container", () => {
    const containerName = vi.fn((app: string) => app);

    resolveWidgets([{ type: "clock", column: 1 }], { domain: "test.local", containerName, secret: noSecret });

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
