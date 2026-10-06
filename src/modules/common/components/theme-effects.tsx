"use client";

import { useAtomValue } from "jotai";
import { useLayoutEffect } from "react";
import { Theme, type ColorMode } from "#libs/preferences";
import { colorModeAtom, themePaletteAtom } from "#modules/common/atoms/theme.ts";

function persistPreference(name: string, value: string) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";

  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${Theme.CookieMaxAge}; samesite=lax${secure}`;
}

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
    persistPreference(Theme.PaletteCookie, palette);
  }, [palette]);

  useLayoutEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemPreference = () => applyColorMode(mode, colorScheme.matches);

    applySystemPreference();
    persistPreference(Theme.ColorModeCookie, mode);

    if (mode !== "system") {
      return;
    }

    colorScheme.addEventListener("change", applySystemPreference);

    return () => colorScheme.removeEventListener("change", applySystemPreference);
  }, [mode]);

  return null;
}
