import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { UserPreferences } from "#libs/preferences";
import { Routes } from "#app/routes.tsx";
import { AppProviders } from "#modules/common/components/app-providers.tsx";

const english: UserPreferences = { theme: "light", themePalette: "claude", locale: "en" };

/** The page at `path`, with the preferences the cookies gave. */
function renderAt(path: string, preferences: UserPreferences = english) {
  const router = Routes.createRouter(createMemoryHistory({ initialEntries: [path] }));

  render(
    <AppProviders preferences={preferences}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

describe("the shell", () => {
  afterEach(() => {
    cleanup();
    document.cookie = "theme=; max-age=0; path=/";
    document.cookie = "theme_palette=; max-age=0; path=/";
  });

  it("lights the section of the path", async () => {
    renderAt("/apps");

    const current = await screen.findAllByRole("link", { current: "page" });

    expect(current.map(link => link.textContent)).toContain("Apps");
  });

  it("shows a path that is no page in the app's frame, its section lit", async () => {
    renderAt("/apps/alpha");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeDefined();

    const current = screen.getAllByRole("link", { current: "page" });

    expect(current.map(link => link.textContent)).toContain("Apps");
  });

  it("speaks the language of the cookie", async () => {
    renderAt("/settings", { ...english, locale: "fr" });

    expect(await screen.findByRole("heading", { name: "Pas encore ici" })).toBeDefined();
    expect(screen.getAllByRole("link", { name: "Paramètres" }).length).toBeGreaterThan(0);
    expect(document.documentElement.lang).toBe("fr");
  });

  it("applies the palette and the mode of the cookies, and keeps them", async () => {
    renderAt("/", { ...english, theme: "dark", themePalette: "nord" });

    await screen.findByRole("heading", { name: "Not here yet" });

    expect(document.documentElement.dataset.theme).toBe("nord");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.cookie).toContain("theme=dark");
    expect(document.cookie).toContain("theme_palette=nord");
  });
});
