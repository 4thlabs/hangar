import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { createQueryClient } from "#libs/api";
import { Preferences } from "#libs/preferences";
import { Routes } from "#app/routes.tsx";
import { SessionGuard } from "#modules/auth/session-guard.ts";
import { AppProviders } from "#modules/common/components/app-providers.tsx";

/** The signed-in user of the pages under test. */
export const ana = { name: "Ana Lima", email: "ana@example.com" };

/** The server's answer to a call, by `METHOD /path` with its query, given the call's body: now, or once it settles. */
export type Answers = Record<string, (body: unknown) => Response | Promise<Response>>;

/** A problem of `status`, as the server answers an error, with `detail`. */
export function problem(status: number, detail: string): Response {
  const body = { type: "about:blank", title: "Error", status, detail };

  return Response.json(body, { status, headers: { "Content-Type": "application/problem+json" } });
}

/** The problem of Hangar's error `code`, with its English `detail` and its `params` as members, as the server answers. */
export function coded(status: number, code: string, detail: string, params: Record<string, unknown> = {}): Response {
  const body = { type: `/problems/${code}`, title: "Error", status, detail, ...params };

  return Response.json(body, { status, headers: { "Content-Type": "application/problem+json" } });
}

/** A 401 problem, as the server answers a call without a session. */
export function unauthorized(): Response {
  return problem(401, "no session");
}

/** The JSON `items`, as the server streams the items of an `Events` route. */
export function events(items: readonly unknown[]): Response {
  const body = items.map(item => `data: ${JSON.stringify(item)}\n\n`).join("");

  return new Response(`:\n\n${body}`, { headers: { "Content-Type": "text/event-stream" } });
}

/** An `EventSource` the test drives: each one the page opens is kept, which the test opens and sends items on. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  /** Every source opened since `serve`. */
  static sources: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.sources.push(this);
  }

  /** The last source of `url` the page holds open. */
  static of(url: string): FakeEventSource | undefined {
    return FakeEventSource.sources.findLast(
      source => source.url === url && source.readyState !== FakeEventSource.CLOSED,
    );
  }

  addEventListener() {}

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  /** The server answered: the stream is open. */
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  /** An item of the stream. */
  send(item: unknown) {
    this.onmessage?.({ data: JSON.stringify(item) });
  }

  /** The stream is lost for good, as when the server answers a 502 while it restarts. */
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
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
  FakeEventSource.sources = [];
  vi.stubGlobal("EventSource", FakeEventSource);

  return fetch;
}

/** The page at `path`, with the preferences the cookies hold. */
export function renderAt(path: string) {
  const queryClient = createQueryClient(() => SessionGuard.signedOut(router, queryClient));
  const router = Routes.createRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));

  render(
    <AppProviders queryClient={queryClient} preferences={Preferences.fromCookies(document.cookie)}>
      <RouterProvider router={router} />
    </AppProviders>,
  );

  return router;
}
