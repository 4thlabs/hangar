import { describe, expect, it } from "vitest";
import { getUserPreferences, parseUserPreferences, runWithUserPreferences } from "./server.ts";

describe("parseUserPreferences", () => {
  it("uses defaults when no preferences are stored", () => {
    expect(parseUserPreferences("")).toEqual({
      sidebarOpen: true,
      theme: "system",
      themePalette: "claude",
    });
  });

  it("reads sidebar and theme preferences from cookies", () => {
    expect(parseUserPreferences("sidebar_state=false; theme=dark; theme_palette=nord")).toEqual({
      sidebarOpen: false,
      theme: "dark",
      themePalette: "nord",
    });
  });

  it("ignores invalid preference values", () => {
    expect(parseUserPreferences("sidebar_state=invalid; theme=blue; theme_palette=unknown")).toEqual({
      sidebarOpen: true,
      theme: "system",
      themePalette: "claude",
    });
  });

  it("exposes preferences only within the intercepted request", async () => {
    const preferences = { sidebarOpen: false, theme: "light", themePalette: "nord" } as const;

    await runWithUserPreferences(preferences, async () => {
      expect(getUserPreferences()).toEqual(preferences);
    });

    expect(getUserPreferences()).toEqual({
      sidebarOpen: true,
      theme: "system",
      themePalette: "claude",
    });
  });
});
