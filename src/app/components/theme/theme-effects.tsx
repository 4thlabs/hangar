"use client";

import { useLayoutEffect } from "react";
import { useAtomValue } from "jotai";
import { colorModeAtom, themePaletteAtom } from "#app/atoms/theme.ts";
import {
  THEME_COOKIE_MAX_AGE,
  THEME_COOKIE_NAME,
  THEME_PALETTE_COOKIE_NAME,
} from "../../../libs/preferences/shared/constants.ts";
import type { ColorMode } from "../../../libs/preferences/shared/themes.ts";

function persistPreference(name: string, value: string) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax${secure}`;
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
    persistPreference(THEME_PALETTE_COOKIE_NAME, palette);
  }, [palette]);

  useLayoutEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemPreference = () => applyColorMode(mode, colorScheme.matches);

    applySystemPreference();
    persistPreference(THEME_COOKIE_NAME, mode);

    if (mode !== "system") return;

    colorScheme.addEventListener("change", applySystemPreference);
    return () => colorScheme.removeEventListener("change", applySystemPreference);
  }, [mode]);

  return null;
}
