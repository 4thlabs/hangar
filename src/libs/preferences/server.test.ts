import { describe, expect, it } from "vitest";
import { getUserPreferences, parseUserPreferences, runWithUserPreferences } from "./server.ts";
import { COLOR_MODES, THEME_PALETTES } from "./shared/themes.ts";

describe("parseUserPreferences", () => {
  it("uses defaults when no preferences are stored", () => {
    expect(parseUserPreferences("")).toEqual({
      theme: "system",
      themePalette: "claude",
    });
  });

  it("reads theme preferences from cookies", () => {
    expect(parseUserPreferences("theme=dark; theme_palette=nord")).toEqual({
      theme: "dark",
      themePalette: "nord",
    });
  });

  // Driven off the tuple so a new palette is covered without a new test.
  it.each(THEME_PALETTES.map(palette => palette.value))("accepts the %s palette", palette => {
    expect(parseUserPreferences(`theme_palette=${palette}`).themePalette).toBe(palette);
  });

  it.each(COLOR_MODES.map(mode => mode.value))("accepts the %s color mode", mode => {
    expect(parseUserPreferences(`theme=${mode}`).theme).toBe(mode);
  });

  it("ignores invalid preference values", () => {
    expect(parseUserPreferences("theme=blue; theme_palette=unknown")).toEqual({
      theme: "system",
      themePalette: "claude",
    });
  });

  it("exposes preferences only within the intercepted request", async () => {
    const preferences = { theme: "light", themePalette: "nord" } as const;

    await runWithUserPreferences(preferences, async () => {
      expect(getUserPreferences()).toEqual(preferences);
    });

    expect(getUserPreferences()).toEqual({
      theme: "system",
      themePalette: "claude",
    });
  });
});

describe("theme palettes", () => {
  // The tuple is the source of truth; a palette with no stylesheet renders unstyled.
  it("all have a stylesheet imported by styles.css", async () => {
    const styles = await import("node:fs/promises").then(fs => fs.readFile("src/app/styles.css", "utf8"));

    for (const { value } of THEME_PALETTES) {
      expect(styles, `theme-${value}.css is not imported by styles.css`).toContain(`./theme/theme-${value}.css`);
    }
  });
});
