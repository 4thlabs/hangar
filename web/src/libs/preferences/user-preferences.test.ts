import { describe, expect, it } from "vitest";
import { Locale } from "./locale.ts";
import { Theme } from "./theme.ts";
import { UserPreferencesCookies } from "./user-preferences.ts";

describe("UserPreferencesCookies", () => {
  it("uses defaults when no preferences are stored", () => {
    expect(UserPreferencesCookies.parse("")).toEqual({
      theme: "system",
      themePalette: "claude",
      locale: "en",
    });
  });

  it("reads theme preferences from cookies", () => {
    expect(UserPreferencesCookies.parse("theme=dark; theme_palette=nord")).toEqual({
      theme: "dark",
      themePalette: "nord",
      locale: "en",
    });
  });

  // Driven off the tuple so a new palette is covered without a new test.
  it.each(Theme.Palettes.map(palette => palette.value))("accepts the %s palette", palette => {
    expect(UserPreferencesCookies.parse(`theme_palette=${palette}`).themePalette).toBe(palette);
  });

  it.each(Theme.ColorModes)("accepts the %s color mode", mode => {
    expect(UserPreferencesCookies.parse(`theme=${mode}`).theme).toBe(mode);
  });

  it.each(Locale.Locales.map(locale => locale.value))("accepts the %s locale", locale => {
    expect(UserPreferencesCookies.parse(`locale=${locale}`).locale).toBe(locale);
  });

  it("ignores invalid preference values", () => {
    expect(UserPreferencesCookies.parse("theme=blue; theme_palette=unknown; locale=de")).toEqual({
      theme: "system",
      themePalette: "claude",
      locale: "en",
    });
  });
});
