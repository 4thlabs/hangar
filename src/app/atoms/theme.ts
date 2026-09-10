import { atom } from "jotai";

import {
  DEFAULT_COLOR_MODE,
  DEFAULT_THEME_PALETTE,
  type ColorMode,
  type ThemePalette,
} from "../../libs/preferences/shared/themes.ts";

export const themePaletteAtom = atom<ThemePalette>(DEFAULT_THEME_PALETTE);
export const colorModeAtom = atom<ColorMode>(DEFAULT_COLOR_MODE);
