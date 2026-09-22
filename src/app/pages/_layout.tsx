import "../styles.css";

import type { ReactNode } from "react";
import { AppProviders } from "#app/providers/app-providers.tsx";
import { getUserPreferences } from "#libs/preferences";

type RootLayoutProps = { children: ReactNode };

export default function RootLayout({ children }: RootLayoutProps) {
  const { theme, themePalette } = getUserPreferences();

  return (
    <AppProviders initialPalette={themePalette} initialMode={theme}>
      <div className="min-h-svh font-sans">
        <meta name="description" content="Hangar — vos applications auto-hébergées." />
        <link rel="icon" type="image/png" href="/images/favicon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        {/* iOS only reads the manifest icons since 17.4; before that this tag is all it looks at. */}
        <link rel="apple-touch-icon" href="/images/icon.png" />
        {/* ponytail: pinned to Nord, while the app ships 8 palettes × light/dark — varying the tint
            per palette would duplicate 16 values the CSS already holds. Revisit if the mismatch shows. */}
        {theme === "system" ? (
          <>
            <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#2e3440" />
            <meta name="theme-color" media="(prefers-color-scheme: light)" content="#eceff4" />
          </>
        ) : (
          <meta name="theme-color" content={theme === "dark" ? "#2e3440" : "#eceff4"} />
        )}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400..700;1,400..700&family=Merriweather:ital,wght@0,400;0,700;1,400;1,700&family=Montserrat:ital,wght@0,400..700;1,400..700&family=Nunito:ital,wght@0,400;0,700;1,400;1,700&family=Plus+Jakarta+Sans:ital,wght@0,400..700;1,400..700&family=Source+Serif+4:ital,wght@0,400..700;1,400..700&family=Ubuntu+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap"
          precedence="font"
        />

        {children}
      </div>
    </AppProviders>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
