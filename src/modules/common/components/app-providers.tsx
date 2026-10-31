"use client";

import { createStore, Provider } from "jotai";
import { useState, type ReactNode } from "react";
import { Unstable_SearchCodecsProvider } from "waku/router/client";
import type { ColorMode, LocaleCode, ThemePalette } from "#libs/preferences";
import { appsSearchCodec } from "#modules/apps/search-codec.ts";
import { ClusterSearch } from "#modules/cluster/search.ts";
import { localeAtom } from "#modules/common/atoms/locale.ts";
import { colorModeAtom, themePaletteAtom } from "#modules/common/atoms/theme.ts";
import { ThemeEffects } from "#modules/common/components/theme-effects.tsx";
import { Toaster } from "#modules/common/ui/toast.tsx";
import { storeSearchCodec } from "#modules/store/search-codec.ts";

const searchCodecs = [storeSearchCodec, appsSearchCodec, ClusterSearch.Codec];

type AppProvidersProps = {
  children: ReactNode;
  initialPalette: ThemePalette;
  initialMode: ColorMode;
  initialLocale: LocaleCode;
};

export function AppProviders({ children, initialPalette, initialMode, initialLocale }: AppProvidersProps) {
  const [store] = useState(() => {
    const initialStore = createStore();

    initialStore.set(themePaletteAtom, initialPalette);
    initialStore.set(colorModeAtom, initialMode);
    initialStore.set(localeAtom, initialLocale);

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
