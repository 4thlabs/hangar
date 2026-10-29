import { describe, expect, it } from "vitest";
import { Theme } from "../theme.ts";
import { UninstalledApps } from "../uninstalled-apps.ts";
import { UserPreferencesStore } from "./user-preferences.ts";

describe("UserPreferencesStore", () => {
  it("uses defaults when no preferences are stored", () => {
    expect(UserPreferencesStore.parse("")).toEqual({
      theme: "system",
      themePalette: "claude",
      showUninstalled: false,
    });
  });

  it("reads theme preferences from cookies", () => {
    expect(UserPreferencesStore.parse("theme=dark; theme_palette=nord")).toEqual({
      theme: "dark",
      themePalette: "nord",
      showUninstalled: false,
    });
  });

  it("reads whether the store apps that are not installed are shown", () => {
    expect(UserPreferencesStore.parse("show_uninstalled=1").showUninstalled).toBe(true);
    expect(UserPreferencesStore.parse("show_uninstalled=0").showUninstalled).toBe(false);
    expect(UserPreferencesStore.parse("").showUninstalled).toBe(UninstalledApps.DefaultShown);
  });

  // Driven off the tuple so a new palette is covered without a new test.
  it.each(Theme.Palettes.map(palette => palette.value))("accepts the %s palette", palette => {
    expect(UserPreferencesStore.parse(`theme_palette=${palette}`).themePalette).toBe(palette);
  });

  it.each(Theme.ColorModes.map(mode => mode.value))("accepts the %s color mode", mode => {
    expect(UserPreferencesStore.parse(`theme=${mode}`).theme).toBe(mode);
  });

  it("ignores invalid preference values", () => {
    expect(UserPreferencesStore.parse("theme=blue; theme_palette=unknown")).toEqual({
      theme: "system",
      themePalette: "claude",
      showUninstalled: false,
    });
  });

  it("exposes preferences only within the intercepted request", async () => {
    const preferences = { theme: "light", themePalette: "nord", showUninstalled: true } as const;

    const store = new UserPreferencesStore();

    await store.run(preferences, async () => {
      expect(store.get()).toEqual(preferences);
    });

    expect(store.get()).toEqual({
      theme: "system",
      themePalette: "claude",
      showUninstalled: false,
    });
  });
});
