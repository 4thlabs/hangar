import "./styles.css";
// The palettes' fonts, served by Hangar itself: a stylesheet from a font CDN blocks the first paint,
// and leaves the page blank for as long as the CDN cannot be reached.
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/nunito";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClients } from "#libs/api";
import { UserPreferencesCookies } from "#libs/preferences";
import { Routes } from "#app/routes.tsx";
import { SessionGuard } from "#modules/auth/session-guard.ts";
import { AppProviders } from "#modules/common/components/app-providers.tsx";

const root = document.getElementById("root");

if (!root) {
  throw new Error("index.html has no #root to render the page in");
}

// A 401 of any call sends the page to /login: the session expired, or its user left hangar.yml.
const queryClient = QueryClients.create(() => SessionGuard.signedOut(router, queryClient));
const router = Routes.createRouter(queryClient);

createRoot(root).render(
  <StrictMode>
    <AppProviders queryClient={queryClient} preferences={UserPreferencesCookies.parse(document.cookie)}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
