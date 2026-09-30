"use client";

import { useState, type ReactNode } from "react";
import { createStore, Provider } from "jotai";
import { Unstable_SearchCodecsProvider } from "waku/router/client";
import { colorModeAtom, themePaletteAtom } from "#modules/common/atoms/theme.ts";
import { appsSearchCodec } from "#modules/apps/search-codec.ts";
import { storeSearchCodec } from "#modules/store/search-codec.ts";
import { ThemeEffects } from "#modules/common/components/theme-effects.tsx";
import { Toaster } from "#modules/common/ui/toast.tsx";
import type { ColorMode, ThemePalette } from "#libs/preferences";

const searchCodecs = [storeSearchCodec, appsSearchCodec];

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
      <Unstable_SearchCodecsProvider searchCodecs={searchCodecs}>
        <ThemeEffects />
        {children}
        <Toaster />
      </Unstable_SearchCodecsProvider>
    </Provider>
  );
}
