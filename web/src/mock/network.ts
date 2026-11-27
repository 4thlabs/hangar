import { sse, type PathParams, type ServerSentEventResolverExtras, type UnhandledFrameHandle } from "msw";
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
 * handlers in `#libs/api/mock`, until the test ends. A call no handler answers fails its test (`setup.ts`).
 */
export const network = setupServer(...shell);

/** What msw said of each call no handler answered, since they were last taken. */
const unhandled: string[] = [];

/**
 * msw's `onUnhandledFrame`: the call fails, as with its `"error"`, and is kept for `takeUnhandledCalls`. msw's strategy
 * alone only rejects the call, which a page shows as a failed card: its test would pass on a call it never said the
 * page makes. The callback throws a network error, which msw answers the call with: one that returns lets the call
 * through to the real network.
 */
export const keepUnhandled: Exclude<UnhandledFrameHandle, string> = async ({ frame }) => {
  unhandled.push(await frame.getUnhandledMessage());

  throw Response.error();
};

/** What msw said of each call no handler answered since the last time, which is then forgotten. */
export function takeUnhandledCalls(): string[] {
  return unhandled.splice(0);
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
