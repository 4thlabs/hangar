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
        <head>
          {/* The server cannot know the OS preference: without this the first paint is light and
              the class lands only after hydration. Runs before paint, so no flash. */}
          {theme === "system" ? (
            <script
              dangerouslySetInnerHTML={{
                __html: `matchMedia("(prefers-color-scheme: dark)").matches&&document.documentElement.classList.add("dark")`,
              }}
            />
          ) : null}
        </head>
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
