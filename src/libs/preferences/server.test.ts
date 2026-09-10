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

  it("accepts registered palettes", () => {
    expect(parseUserPreferences("theme=light; theme_palette=vintage-paper")).toMatchObject({
      theme: "light",
      themePalette: "vintage-paper",
    });
  });

  it("accepts the VS Code palette", () => {
    expect(parseUserPreferences("theme=dark; theme_palette=vs-code")).toMatchObject({
      theme: "dark",
      themePalette: "vs-code",
    });
  });

  it("accepts the Northern Lights palette", () => {
    expect(parseUserPreferences("theme=system; theme_palette=northern-lights")).toMatchObject({
      theme: "system",
      themePalette: "northern-lights",
    });
  });

  it("accepts the Nord Frost palette", () => {
    expect(parseUserPreferences("theme=dark; theme_palette=nord-frost")).toMatchObject({
      theme: "dark",
      themePalette: "nord-frost",
    });
  });

  it("accepts the Sunset Horizon palette", () => {
    expect(parseUserPreferences("theme=light; theme_palette=sunset-horizon")).toMatchObject({
      theme: "light",
      themePalette: "sunset-horizon",
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
