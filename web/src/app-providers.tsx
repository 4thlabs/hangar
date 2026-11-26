import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Preferences } from "#libs/preferences";
import { PreferencesContext } from "#modules/common/hooks/use-preferences.ts";
import { Toaster } from "#modules/common/ui/toast.tsx";
import { ThemeEffects } from "#theme-effects.tsx";

type AppProvidersProps = {
  children: ReactNode;
  /** The page's query client, which the router reads too. */
  queryClient: QueryClient;
  /** The user's preferences, from the cookies the page loaded with. */
  preferences: Preferences;
};

/** What every page reads beside the router: the query client, the preferences, and the toasts. */
export function AppProviders({ children, queryClient, preferences }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesContext value={preferences}>
        <ThemeEffects />
        {children}
        <Toaster />
      </PreferencesContext>
    </QueryClientProvider>
  );
}
