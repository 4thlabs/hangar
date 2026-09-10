import type { ReactNode } from "react";
import { ErrorBoundary } from "waku/router/client";
import { getUserPreferences } from "#libs/preferences";
type RootProps = {
  /** Everything below <body>: the layout of whichever route group matched. */
  children: ReactNode;
};

export default function Root({ children }: RootProps) {
  const { theme, themePalette } = getUserPreferences();

  return (
    <ErrorBoundary>
      <html
        lang="fr"
        className={theme === "dark" ? "dark" : undefined}
        data-theme={themePalette}
        data-color-mode={theme}
        suppressHydrationWarning
      >
        <head></head>
        <body>{children}</body>
      </html>
    </ErrorBoundary>
  );
}

/**
 * Dynamic: reads request-scoped theme preferences.
 */
export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
