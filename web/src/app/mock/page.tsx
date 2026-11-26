import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { QueryClients } from "#libs/api";
import type { UserPreferences } from "#libs/preferences";
import { Routes } from "#app/routes.tsx";
import { SessionGuard } from "#modules/auth/session-guard.ts";
import { AppProviders } from "#modules/common/components/app-providers.tsx";

/** The signed-in user of the pages under test. */
export const ana = { name: "Ana Lima", email: "ana@example.com" };

/** The server's answer to a call, by `METHOD /path` with its query, given the call's body. */
export type Answers = Record<string, (body: unknown) => Response>;

/** A problem of `status`, as the server answers an error, with `detail`. */
export function problem(status: number, detail: string): Response {
  const body = { type: "about:blank", title: "Error", status, detail };

  return Response.json(body, { status, headers: { "Content-Type": "application/problem+json" } });
}

/** A 401 problem, as the server answers a call without a session. */
export function unauthorized(): Response {
  return problem(401, "no session");
}

/** Answers every `fetch` from `answers`, a signed-in session with no provider unless they say otherwise. */
export function serve(answers: Answers = {}) {
  const all: Answers = {
    "GET /api/auth/session": () => Response.json(ana),
    "GET /api/auth/options": () => Response.json({ oidc: false }),
    ...answers,
  };

  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const answer = all[`${init.method ?? "GET"} ${url}`];
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;

    return answer ? answer(body) : new Response(null, { status: 404 });
  });

  vi.stubGlobal("fetch", fetch);

  return fetch;
}

/** The page at `path`, with the preferences the cookies gave, light unless they say otherwise. */
export function renderAt(path: string, preferences: UserPreferences = { theme: "light", themePalette: "claude" }) {
  const queryClient = QueryClients.create(() => SessionGuard.signedOut(router, queryClient));
  const router = Routes.createRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));

  render(
    <AppProviders queryClient={queryClient} preferences={preferences}>
      <RouterProvider router={router} />
    </AppProviders>,
  );

  return router;
}
