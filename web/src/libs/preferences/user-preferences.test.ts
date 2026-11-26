import { describe, expect, it } from "vitest";
import { colorModes, themePalettes } from "./theme.ts";
import { parsePreferences } from "./user-preferences.ts";

describe("parsePreferences", () => {
  it("uses defaults when no preferences are stored", () => {
    expect(parsePreferences("")).toEqual({ theme: "system", themePalette: "claude" });
  });

  it("reads theme preferences from cookies", () => {
    expect(parsePreferences("theme=dark; theme_palette=nord")).toEqual({
      theme: "dark",
      themePalette: "nord",
    });
  });

  // Driven off the tuple so a new palette is covered without a new test.
  it.each(themePalettes.map(palette => palette.value))("accepts the %s palette", palette => {
    expect(parsePreferences(`theme_palette=${palette}`).themePalette).toBe(palette);
  });

  it.each(colorModes)("accepts the %s color mode", mode => {
    expect(parsePreferences(`theme=${mode}`).theme).toBe(mode);
  });

  it("ignores invalid preference values", () => {
    expect(parsePreferences("theme=blue; theme_palette=unknown")).toEqual({
      theme: "system",
      themePalette: "claude",
    });
  });
});
