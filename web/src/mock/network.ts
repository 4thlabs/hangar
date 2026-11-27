import {
  isCommonAssetRequest,
  RequestHandler,
  sse,
  type AnyHandler,
  type PathParams,
  type ServerSentEventResolverExtras,
} from "msw";
import { setupServer } from "msw/node";
import { onTestFinished } from "vitest";
import type { ErrorDetail } from "#libs/api";
import { getAuthOptionsMockHandler, getAuthSessionMockHandler, getNotificationsListMockHandler } from "#libs/api/mock";

/** The signed-in user of the pages under test. */
export const ana = { name: "Ana Lima", email: "ana@example.com" };

/**
 * What the shell calls on every page: a signed-in session, no provider to sign in with, an empty bell, and its stream,
 * which stays open and sends nothing.
 */
const shell = [
  getAuthSessionMockHandler(ana),
  getAuthOptionsMockHandler({ oidc: false }),
  getNotificationsListMockHandler({ epoch: "first", notifications: [] }),
  sse("*/api/notifications/events", () => {}),
];

/**
 * The server the tests' calls reach, at the network: `shell`, and what a test adds with `network.use(...)`, from orval's
 * handlers in `#libs/api/mock`, until the test ends. A call of the global `fetch` that no handler in place matches fails
 * the first check after it is made (`setup.ts`), through `trackedFetch` and `unhandledCalls`: only `fetch` is checked.
 */
export const network = setupServer(...shell);

/**
 * The calls the page made since the last check: each one no handler in place matched, as `METHOD /path?query`, else
 * `null`. None rejects.
 */
const calls: Promise<string | null>[] = [];

/**
 * Whether no handler of `handlers` matches `request`, as msw picks one: by each handler's own `test`, msw's public
 * check of a request against a handler, quiet as msw's own lookup is not, so that an `sse()` handler logs nothing. A
 * request `bypass()` marked goes past msw, and a common asset (a font, an image) is let through by msw's `"error"`:
 * neither fails a test. The one rule of msw's left out is `{ once: true }`, which no test uses.
 *
 * @returns The call, `METHOD /path?query`, when no handler matches it, or with the error of a handler whose check
 *   threw; else `null`. It never rejects.
 */
async function unmatched(request: Request, handlers: readonly AnyHandler[]): Promise<string | null> {
  const url = new URL(request.url);
  const call = `${request.method} ${url.pathname}${url.search}`;
  const isBypassed = request.headers.get("accept")?.includes("msw/passthrough") === true;

  if (isBypassed || isCommonAssetRequest(request)) {
    return null;
  }

  try {
    for (const handler of handlers) {
      if (handler instanceof RequestHandler && (await handler.test({ request, resolutionContext: { quiet: true } }))) {
        return null;
      }
    }
  } catch (error) {
    return `${call} (a handler's check of it threw: ${String(error)})`;
  }

  return call;
}

/**
 * `fetch`, each of whose calls is checked against the handlers in place at the moment the page makes it, before
 * anything can abort it or msw sees it: the check needs no network, and `unhandledCalls` awaits it.
 *
 * The handlers checked are those in place then, not when msw answers: a call made before the test adds its handler with
 * `network.use` is answered by msw but fails the check; and a call made on the test's last line to a handler the test
 * added passes the check, then, as `resetHandlers` ran meanwhile, gets msw's own error, printed under the next test.
 */
export function trackedFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    let request: Request;

    try {
      request = new Request(input, init);
    } catch {
      // No request can be made of it: `fetch` rejects it, and nothing reaches a handler.
      return fetch(input, init);
    }

    // The check reads a copy, so that a handler that reads the body cannot lock the one sent.
    calls.push(unmatched(request.clone(), network.listHandlers()));

    return fetch(request);
  };
}

/**
 * The calls made since the last time that no handler in place matched, as `METHOD /path?query`, which are then
 * forgotten.
 */
export async function unhandledCalls(): Promise<string[]> {
  const checked = await Promise.all(calls.splice(0));

  return checked.filter(call => call !== null);
}

/** A problem of `status`, as the server answers an error, with `detail`: thrown from a handler, which sends it. */
export function problem(status: number, detail: string): Response {
  const body = { type: "about:blank", title: "Error", status, detail };

  return Response.json(body, { status, headers: { "Content-Type": "application/problem+json" } });
}

/**
 * The problem of one of Hangar's errors, as the server answers it: its code as the type, its params as members, its
 * English message as the detail. Typed by the contract, so a code or a param it does not have is a type error.
 */
export function coded(status: number, error: ErrorDetail): Response {
  const params = "params" in error ? error.params : {};
  const body = { type: `/problems/${error.code}`, title: "Error", status, detail: error.message, ...params };

  return Response.json(body, { status, headers: { "Content-Type": "application/problem+json" } });
}

/** A 401 problem, as the server answers a call without a session. */
export function unauthorized(): Response {
  return problem(401, "no session");
}

/**
 * Counts the calls the page makes from now to the end of the test, by `METHOD /path`, the query left out:
 * `calls("GET /api/docker/overview")`.
 */
export function countCalls(): (call: string) => number {
  const made: string[] = [];

  const listener = ({ request }: { request: Request }) => {
    made.push(`${request.method} ${new URL(request.url).pathname}`);
  };

  network.events.on("request:start", listener);
  onTestFinished(() => network.events.removeListener("request:start", listener));

  return call => made.filter(found => found === call).length;
}

/**
 * An `Events` route at `path`, as msw's `sse()`: orval's handler for one answers a word of text. Each stream the page
 * opens stays open, and opens once `opened` resolves, at once without it; the test sends items on the last one.
 *
 * @returns Its `handler`, for `network.use`, the URLs the page opened it at, with their query, and `send(item)`.
 */
export function feed<T>(path: string, opened: Promise<void> = Promise.resolve()) {
  type Client = ServerSentEventResolverExtras<{ message: string }, PathParams>["client"];

  const clients: Client[] = [];
  const urls: string[] = [];

  const handler = sse<{ message: string }>(`*${path}`, async ({ client, request }) => {
    const url = new URL(request.url);

    urls.push(`${url.pathname}${url.search}`);
    await opened;
    clients.push(client);
    // quoll's server sends an empty comment with the head, which msw's client cannot write: the head would wait for
    // the first item, and the page would not see the stream open. A `retry` field, which dispatches nothing, goes
    // instead, at `EventSource`'s usual wait.
    client.send({ retry: 3_000 });
  });

  return {
    handler,
    urls,
    /** Sends `item` on the last stream the page opened, as its JSON; throws when it opened none. */
    send(item: T) {
      const client = clients.at(-1);

      if (client === undefined) {
        throw new Error(`the page opened no stream of ${path}`);
      }

      // As JSON, as the server sends every item: msw writes a string as it is, and the page would read `overview`
      // where the server sends `"overview"`.
      client.send({ data: JSON.stringify(item) });
    },
  };
}

/**
 * The body of an `Events` route that ends, for orval's handler of it: an empty comment, as the server opens with, then
 * each item as the JSON `data` of an event, as `getDockerLogsMockHandler(events(lines))`.
 */
export function events<T>(items: readonly T[]): string {
  return `:\n\n${items.map(item => `data: ${JSON.stringify(item)}\n\n`).join("")}`;
}
