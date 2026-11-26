import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ana, coded, renderAt, serve, unauthorized } from "#app/mock/page.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = "theme=; max-age=0; path=/";
  document.cookie = "theme_palette=; max-age=0; path=/";
});

describe("the shell", () => {
  it("lights the section of the path", async () => {
    serve();
    renderAt("/apps");

    const current = await screen.findAllByRole("link", { current: "page" });

    expect(current.map(link => link.textContent)).toContain("Apps");
  });

  it("shows a path that is no page in the app's frame, its section lit", async () => {
    serve();
    renderAt("/apps/alpha/nowhere");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeDefined();

    const current = screen.getAllByRole("link", { current: "page" });

    expect(current.map(link => link.textContent)).toContain("Apps");
  });

  it("applies the palette and the mode of the cookies, and keeps them", async () => {
    serve();
    renderAt("/", { theme: "dark", themePalette: "nord" });

    await screen.findByRole("button", { name: "User menu of Ana Lima" });

    expect(document.documentElement.dataset.theme).toBe("nord");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.cookie).toContain("theme=dark");
    expect(document.cookie).toContain("theme_palette=nord");
  });

  it("names the signed-in user in the navbar", async () => {
    serve();
    renderAt("/");

    expect(await screen.findByRole("button", { name: "User menu of Ana Lima" })).toBeDefined();
  });
});

describe("signing in", () => {
  it("sends a page without a session to /login", async () => {
    serve({ "GET /api/auth/session": unauthorized });

    const router = renderAt("/apps");

    expect(await screen.findByRole("heading", { name: "Sign in to Hangar" })).toBeDefined();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("signs in by password and opens the dashboard", async () => {
    let signedIn = false;

    const fetch = serve({
      "GET /api/auth/session": () => (signedIn ? Response.json(ana) : unauthorized()),
      "POST /api/auth/login": () => {
        signedIn = true;

        return Response.json(ana);
      },
    });

    const router = renderAt("/login");

    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("button", { name: "User menu of Ana Lima" })).toBeDefined();
    expect(router.state.location.pathname).toBe("/");

    const login = fetch.mock.calls.find(([url]) => url === "/api/auth/login");
    const body = login?.[1]?.body;

    expect(typeof body === "string" ? JSON.parse(body) : body).toEqual({
      email: "ana@example.com",
      password: "correct horse",
    });
  });

  it("says a wrong password is one", async () => {
    serve({
      "GET /api/auth/session": unauthorized,
      "POST /api/auth/login": () => coded(401, "auth.invalid_credentials", "invalid email or password"),
    });

    renderAt("/login");

    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong horse" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid email or password.")).toBeDefined();
  });

  it("offers the identity provider when one is configured", async () => {
    serve({ "GET /api/auth/options": () => Response.json({ oidc: true }) });
    renderAt("/login");

    const link = await screen.findByRole("link", { name: "Sign in with single sign-on" });

    expect(link.getAttribute("href")).toBe("/api/auth/oidc/login");
  });

  it("offers no provider when none is configured", async () => {
    serve();
    renderAt("/login");

    await screen.findByRole("heading", { name: "Sign in to Hangar" });

    expect(screen.queryByRole("link", { name: "Sign in with single sign-on" })).toBeNull();
  });

  it("says why the provider's sign-in was refused", async () => {
    serve();
    renderAt("/login?error=not-a-user");

    expect(
      await screen.findByText("This account is not one of Hangar's users: hangar.yml does not list it."),
    ).toBeDefined();
  });
});
