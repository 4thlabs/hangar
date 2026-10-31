"use client";

import { useAtomValue } from "jotai";
import { useLayoutEffect } from "react";
import { Theme, type ColorMode } from "#libs/preferences";
import { colorModeAtom, themePaletteAtom } from "#modules/common/atoms/theme.ts";
import { PreferenceCookie } from "#modules/common/preference-cookie.ts";

function applyColorMode(mode: ColorMode, prefersDark: boolean) {
  const root = document.documentElement;
  const isDark = mode === "dark" || (mode === "system" && prefersDark);

  root.dataset.colorMode = mode;
  root.classList.toggle("dark", isDark);
}

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
    PreferenceCookie.write(Theme.ColorModeCookie, mode);

    if (mode !== "system") {
      return;
    }

    colorScheme.addEventListener("change", applySystemPreference);

    return () => colorScheme.removeEventListener("change", applySystemPreference);
  }, [mode]);

  return null;
}
