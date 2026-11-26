import { afterEach, describe, expect, it, vi } from "vitest";
import { Preferences } from "./preferences.ts";

/** Forgets the cookies a test wrote, for the next one. */
function clearCookies() {
  for (const name of ["theme", "theme_palette"]) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
}

describe("Preferences", () => {
  afterEach(clearCookies);

  it("starts from the preferences the cookies hold, with the defaults for the others", () => {
    expect(Preferences.fromCookies("theme_palette=nord").current).toEqual({ theme: "system", themePalette: "nord" });
  });

  it("writes the cookie of a change, and tells its subscribers", () => {
    const preferences = new Preferences({ theme: "light", themePalette: "claude" });
    const listener = vi.fn();

    preferences.subscribe(listener);
    preferences.set({ theme: "dark" });

    expect(preferences.current).toEqual({ theme: "dark", themePalette: "claude" });
    expect(document.cookie).toContain("theme=dark");
    expect(document.cookie).not.toContain("theme_palette");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("writes the cookies of every preference it renews, the defaults included", () => {
    Preferences.fromCookies("").renew();

    expect(document.cookie).toContain("theme=system");
    expect(document.cookie).toContain("theme_palette=claude");
  });

  it("keeps the same preferences until a change, and tells no one who left", () => {
    const preferences = new Preferences({ theme: "light", themePalette: "claude" });
    const listener = vi.fn();
    const before = preferences.current;

    expect(preferences.current).toBe(before);

    preferences.subscribe(listener)();
    preferences.set({ themePalette: "nord" });

    expect(preferences.current).not.toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});
