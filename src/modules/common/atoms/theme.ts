import { atom } from "jotai";

import { Theme, type ColorMode, type ThemePalette } from "#libs/preferences";

export const themePaletteAtom = atom<ThemePalette>(Theme.DefaultPalette);
export const colorModeAtom = atom<ColorMode>(Theme.DefaultColorMode);
