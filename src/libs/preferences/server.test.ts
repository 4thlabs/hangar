import { describe, expect, it } from "vitest";
import { getUserPreferences, parseUserPreferences, runWithUserPreferences } from "./server.ts";

describe("parseUserPreferences", () => {
  it("uses defaults when no preferences are stored", () => {
    expect(parseUserPreferences("")).toEqual({ sidebarOpen: true, theme: "system" });
  });

  it("reads sidebar and theme preferences from cookies", () => {
    expect(parseUserPreferences("sidebar_state=false; theme=dark")).toEqual({
      sidebarOpen: false,
      theme: "dark",
    });
  });

  it("ignores invalid preference values", () => {
    expect(parseUserPreferences("sidebar_state=invalid; theme=blue")).toEqual({
      sidebarOpen: true,
      theme: "system",
    });
  });

  it("exposes preferences only within the intercepted request", async () => {
    const preferences = { sidebarOpen: false, theme: "light" } as const;

    await runWithUserPreferences(preferences, async () => {
      expect(getUserPreferences()).toEqual(preferences);
    });

    expect(getUserPreferences()).toEqual({ sidebarOpen: true, theme: "system" });
  });
});
