import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { useState, type ReactNode } from "react";
import type { UserPreferences } from "#libs/preferences";
import { colorModeAtom, themePaletteAtom } from "#modules/common/atoms/theme.ts";
import { ThemeEffects } from "#modules/common/components/theme-effects.tsx";
import { Toaster } from "#modules/common/ui/toast.tsx";

type AppProvidersProps = {
  children: ReactNode;
  /** The page's query client, which the router reads too. */
  queryClient: QueryClient;
  /** What the cookies said when the page loaded. */
  preferences: UserPreferences;
};

export function AppProviders({ children, queryClient, preferences }: AppProvidersProps) {
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
        <Toaster />
      </Provider>
    </QueryClientProvider>
  );
}
