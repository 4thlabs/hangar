import { QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { useState, type ReactNode } from "react";
import { QueryClients } from "#libs/api";
import type { UserPreferences } from "#libs/preferences";
import { colorModeAtom, themePaletteAtom } from "#modules/common/atoms/theme.ts";
import { ThemeEffects } from "#modules/common/components/theme-effects.tsx";

type AppProvidersProps = {
  children: ReactNode;
  /** What the cookies said when the page loaded. */
  preferences: UserPreferences;
};

export function AppProviders({ children, preferences }: AppProvidersProps) {
  const [queryClient] = useState(() => QueryClients.create());

  const [store] = useState(() => {
    const initialStore = createStore();

    initialStore.set(themePaletteAtom, preferences.themePalette);
    initialStore.set(colorModeAtom, preferences.theme);

    return initialStore;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <ThemeEffects />
        {children}
      </Provider>
    </QueryClientProvider>
  );
}
