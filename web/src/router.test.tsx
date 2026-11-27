import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { sse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Credentials } from "#libs/api";
import {
  getAuthLoginMockHandler,
  getAuthOptionsMockHandler,
  getAuthSessionMockHandler,
  getComposeBatchesMockHandler,
  getDockerProjectsMockHandler,
  getWidgetsPlacementsMockHandler,
} from "#libs/api/mock";
import { ana, coded, network, problem, unauthorized } from "#mock/network.ts";
import { renderAt } from "#mock/page.tsx";

/** What `/apps` calls: no app, no compose run, and the Docker changes feed, quiet. */
const appsPage = [
  getDockerProjectsMockHandler([]),
  getComposeBatchesMockHandler([]),
  sse("*/api/docker/changes", () => {}),
];

/** What `/` calls: a dashboard with no widget. */
const dashboard = [getWidgetsPlacementsMockHandler([])];

/** A session the server refuses, as for a browser that never signed in. */
const signedOut = getAuthSessionMockHandler(() => {
  throw unauthorized();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.cookie = "theme=; max-age=0; path=/";
  document.cookie = "theme_palette=; max-age=0; path=/";
});

describe("the shell", () => {
  it("lights the section of the path", async () => {
    network.use(...appsPage);
    renderAt("/apps");

    const current = await screen.findAllByRole("link", { current: "page" });

    expect(current.map(link => link.textContent)).toContain("Apps");
  });

  it("shows a path that is no page in the app's frame, its section lit", async () => {
    renderAt("/apps/alpha/nowhere");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeDefined();

    const current = screen.getAllByRole("link", { current: "page" });

    expect(current.map(link => link.textContent)).toContain("Apps");
  });

  it("shows a path outside every section as no page, in the app's frame", async () => {
    renderAt("/nowhere");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeDefined();
    expect(screen.getByRole("button", { name: "User menu of Ana Lima" })).toBeDefined();
  });

  it("shows a section not moved to this server yet as a pending page, its section lit", async () => {
    renderAt("/cluster");

    expect(await screen.findByRole("heading", { name: "Not here yet" })).toBeDefined();

    const current = screen.getAllByRole("link", { current: "page" });

    expect(current.map(link => link.textContent)).toContain("Cluster");
  });

  it("writes the cookies of the default preferences at its load, for a browser that has none", async () => {
    network.use(...dashboard);
    renderAt("/");

    await screen.findByRole("button", { name: "User menu of Ana Lima" });

    expect(document.cookie).toContain("theme=system");
    expect(document.cookie).toContain("theme_palette=claude");
  });

  it("applies the palette and the mode of the cookies, and writes them again for another year", async () => {
    network.use(...dashboard);
    document.cookie = "theme=dark; path=/";
    document.cookie = "theme_palette=nord; path=/";

    const set = vi.spyOn(document, "cookie", "set");

    renderAt("/");

    await screen.findByRole("button", { name: "User menu of Ana Lima" });

    expect(document.documentElement.dataset.theme).toBe("nord");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    const written = set.mock.calls.map(([value]) => value);

    expect(written).toContainEqual(expect.stringMatching(/^theme=dark; path=\/; max-age=31536000/));
    expect(written).toContainEqual(expect.stringMatching(/^theme_palette=nord; path=\/; max-age=31536000/));
    expect(document.cookie).toContain("theme=dark");
  });

  it("names the signed-in user in the navbar", async () => {
    network.use(...dashboard);
    renderAt("/");

    expect(await screen.findByRole("button", { name: "User menu of Ana Lima" })).toBeDefined();
  });
});

describe("signing in", () => {
  it("sends a page without a session to /login", async () => {
    network.use(signedOut);

    const router = renderAt("/apps");

    expect(await screen.findByRole("heading", { name: "Sign in to Hangar" })).toBeDefined();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("sends a path that is no page to /login, without a session", async () => {
    network.use(signedOut);

    const router = renderAt("/nowhere");

    expect(await screen.findByRole("heading", { name: "Sign in to Hangar" })).toBeDefined();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("says in the app's frame why the session could not be read, and reads it again on Try again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let down = true;

    network.use(
      ...appsPage,
      getAuthSessionMockHandler(() => {
        if (down) {
          throw problem(500, "the database is locked");
        }

        return ana;
      }),
    );

    renderAt("/apps");
    // The query's three retries, a second, two and four apart.
    await vi.advanceTimersByTimeAsync(8_000);

    expect(await screen.findByRole("heading", { name: "Could not open this page" })).toBeDefined();
    expect(screen.getByText("The database is locked.")).toBeDefined();
    expect(screen.getAllByRole("navigation", { name: "Main navigation" })).not.toHaveLength(0);

    down = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "User menu of Ana Lima" })).toBeDefined();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Could not open this page" })).toBeNull());
  });

  it("sends a signed-in page to /login once a call of its own is answered 401", async () => {
    let expired = false;

    // Before `appsPage`'s: msw answers with the first handler that matches.
    network.use(
      getAuthSessionMockHandler(() => {
        if (expired) {
          throw unauthorized();
        }

        return ana;
      }),
      getDockerProjectsMockHandler(() => {
        expired = true;

        throw unauthorized();
      }),
      ...appsPage,
    );

    const router = renderAt("/apps");

    expect(await screen.findByRole("heading", { name: "Sign in to Hangar" })).toBeDefined();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("signs in by password and opens the dashboard", async () => {
    let signedIn = false;
    const sent: Credentials[] = [];

    network.use(
      ...dashboard,
      getAuthSessionMockHandler(() => {
        if (!signedIn) {
          throw unauthorized();
        }

        return ana;
      }),
      getAuthLoginMockHandler(async ({ request }) => {
        sent.push(await request.json());
        signedIn = true;

        return ana;
      }),
    );

    const router = renderAt("/login");

    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("button", { name: "User menu of Ana Lima" })).toBeDefined();
    expect(router.state.location.pathname).toBe("/");

    expect(sent).toEqual([{ email: "ana@example.com", password: "correct horse" }]);
  });

  it("says a wrong password is one", async () => {
    network.use(
      signedOut,
      getAuthLoginMockHandler(() => {
        throw coded(401, { code: "auth.invalid_credentials", message: "invalid email or password" });
      }),
    );

    renderAt("/login");

    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong horse" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid email or password.")).toBeDefined();
  });

  it("offers the identity provider when one is configured", async () => {
    network.use(getAuthOptionsMockHandler({ oidc: true }));
    renderAt("/login");

    const link = await screen.findByRole("link", { name: "Sign in with single sign-on" });

    expect(link.getAttribute("href")).toBe("/api/auth/oidc/login");
  });

  it("offers no provider when none is configured", async () => {
    renderAt("/login");

    await screen.findByRole("heading", { name: "Sign in to Hangar" });

    expect(screen.queryByRole("link", { name: "Sign in with single sign-on" })).toBeNull();
  });

  it("says why the provider's sign-in was refused", async () => {
    renderAt("/login?error=not-a-user");

    expect(
      await screen.findByText("This account is not one of Hangar's users: hangar.yml does not list it."),
    ).toBeDefined();
  });
});
