import "../styles.css";

import type { ReactNode } from "react";
import { AppProviders } from "#app/providers/app-providers.tsx";
import { getUserPreferences } from "#libs/preferences";

type RootLayoutProps = { children: ReactNode };

export default async function RootLayout({ children }: RootLayoutProps) {
  const data = await getData();
  const { theme, themePalette } = getUserPreferences();

  return (
    <AppProviders initialPalette={themePalette} initialMode={theme}>
      <div className="min-h-svh font-['Nunito']">
        <meta name="description" content={data.description} />
        <link rel="icon" type="image/png" href={data.icon} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,400;0,700;1,400;1,700&display=swap"
          precedence="font"
        />

        {children}
      </div>
    </AppProviders>
  );
}

const getData = async () => {
  const data = {
    description: "An internet website!",
    icon: "/images/favicon.png",
  };

  return data;
};

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
