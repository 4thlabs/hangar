import { useLayoutEffect } from "react";
import type { ColorMode } from "#libs/preferences";
import { usePreferences } from "#modules/common/hooks/use-preferences.ts";

/**
 * The tints of the browser's bar, pinned to Nord, as the Waku version is: varying them per palette would duplicate 4
 * values the CSS already holds.
 */
const barTints = { dark: "#2e3440", light: "#eceff4" } as const;

/** Sets the document's `dark` class to `mode`, `system` following `prefersDark`. */
function applyColorMode(mode: ColorMode, prefersDark: boolean) {
  const root = document.documentElement;
  const isDark = mode === "dark" || (mode === "system" && prefersDark);

  root.dataset.colorMode = mode;
  root.classList.toggle("dark", isDark);
}

/** Sets the `theme-color` metas of `index.html`: one per system preference, or both to the mode picked. */
function applyBarTint(mode: ColorMode) {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const dark = mode === "system" ? meta.media.includes("dark") : mode === "dark";

    meta.content = dark ? barTints.dark : barTints.light;
  }
}

/**
 * Keeps the document on the palette and mode picked: its `dark` class, and the tint of the browser's bar. The cookies
 * `index.html` reads at the next load are written by `Preferences.set`.
 */
export function ThemeEffects() {
  const { themePalette: palette, theme: mode } = usePreferences();

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = palette;
  }, [palette]);

  useLayoutEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemPreference = () => applyColorMode(mode, colorScheme.matches);

    applySystemPreference();
    applyBarTint(mode);

    if (mode !== "system") {
      return;
    }

    colorScheme.addEventListener("change", applySystemPreference);

    return () => colorScheme.removeEventListener("change", applySystemPreference);
  }, [mode]);

  return null;
}
