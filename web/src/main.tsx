import "./styles.css";
// The palettes' fonts, served by Hangar itself: a stylesheet from a font CDN blocks the first paint,
// and leaves the page blank for as long as the CDN cannot be reached.
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/nunito";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { UserPreferencesCookies } from "#libs/preferences";
import { Routes } from "#app/routes.tsx";
import { AppProviders } from "#modules/common/components/app-providers.tsx";

const root = document.getElementById("root");

if (!root) {
  throw new Error("index.html has no #root to render the page in");
}

createRoot(root).render(
  <StrictMode>
    <AppProviders preferences={UserPreferencesCookies.parse(document.cookie)}>
      <RouterProvider router={Routes.createRouter()} />
    </AppProviders>
  </StrictMode>,
);
