import { useAtomValue } from "jotai";
import { useLayoutEffect } from "react";
import { Theme, type ColorMode } from "#libs/preferences";
import { colorModeAtom, themePaletteAtom } from "#modules/common/atoms/theme.ts";
import { PreferenceCookie } from "#modules/common/preference-cookie.ts";

/**
 * The browser bar's tint, by color mode. Pinned to Nord, as the Waku version is: varying it per palette would
 * duplicate 4 values the CSS already holds.
 */
class ThemeColor {
  static readonly Dark = "#2e3440";
  static readonly Light = "#eceff4";

  /** Sets the `theme-color` metas of `index.html`: one per system preference, or both to the mode picked. */
  static apply(mode: ColorMode) {
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      const dark = mode === "system" ? meta.media.includes("dark") : mode === "dark";

      meta.content = dark ? ThemeColor.Dark : ThemeColor.Light;
    }
  }
}

function applyColorMode(mode: ColorMode, prefersDark: boolean) {
  const root = document.documentElement;
  const isDark = mode === "dark" || (mode === "system" && prefersDark);

  root.dataset.colorMode = mode;
  root.classList.toggle("dark", isDark);
}

/** Keeps the document, and the cookies `index.html` reads at the next load, on the palette and mode picked. */
export function ThemeEffects() {
  const palette = useAtomValue(themePaletteAtom);
  const mode = useAtomValue(colorModeAtom);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = palette;
    PreferenceCookie.write(Theme.PaletteCookie, palette);
  }, [palette]);

  useLayoutEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemPreference = () => applyColorMode(mode, colorScheme.matches);

    applySystemPreference();
    ThemeColor.apply(mode);
    PreferenceCookie.write(Theme.ColorModeCookie, mode);

    if (mode !== "system") {
      return;
    }

    colorScheme.addEventListener("change", applySystemPreference);

    return () => colorScheme.removeEventListener("change", applySystemPreference);
  }, [mode]);

  return null;
}
