"use client";

import { useState, type ReactNode } from "react";
import { createStore, Provider } from "jotai";
import { colorModeAtom, themePaletteAtom } from "#app/atoms/theme.ts";
import { ThemeEffects } from "#app/components/theme/theme-effects.tsx";
import { Toaster } from "#app/components/ui/toast.tsx";
import type { ColorMode, ThemePalette } from "../../libs/preferences/shared/themes.ts";

type AppProvidersProps = {
  children: ReactNode;
  initialPalette: ThemePalette;
  initialMode: ColorMode;
};

export function AppProviders({ children, initialPalette, initialMode }: AppProvidersProps) {
  const [store] = useState(() => {
    const initialStore = createStore();
    initialStore.set(themePaletteAtom, initialPalette);
    initialStore.set(colorModeAtom, initialMode);
    return initialStore;
  });

  return (
    <Provider store={store}>
      <ThemeEffects />
      {children}
      <Toaster />
    </Provider>
  );
}
