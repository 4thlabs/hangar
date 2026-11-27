import { sse, type PathParams, type ServerSentEventResolverExtras } from "msw";
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
 * handlers in `#libs/api/mock`, until the test ends. A call no handler answers fails its test (`setup.ts`), through
 * `trackedFetch` and `unhandledCalls`.
 */
export const network = setupServer(...shell);

/** The header the tests' `fetch` names each call by, which msw's events then name it by too. */
const callHeader = "x-hangar-test-call";

/** The calls the page made that msw has not seen yet, and that have not settled either, by id. */
const calls = new Map<string, string>();

/** Each call no handler answered, as `METHOD /path?query`, since they were last taken. */
const unhandled: string[] = [];

let lastCall = 0;

network.events.on("request:start", ({ request }) => {
  calls.delete(request.headers.get(callHeader) ?? "");
});

// msw names a call unhandled once it looked up the handlers, before it rejects it: no handler of the list matched.
network.events.on("request:unhandled", ({ request }) => {
  const url = new URL(request.url);

  unhandled.push(`${request.method} ${url.pathname}${url.search}`);
});

/**
 * `fetch`, each of whose calls is kept from the moment the page makes it until msw sees it, or it settles (as one the
 * page aborts before it is sent), so that `unhandledCalls` waits for it.
 */
export function trackedFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    lastCall += 1;

    const id = String(lastCall);
    const isRequest = input instanceof Request;
    const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined));
    const method = init?.method ?? (isRequest ? input.method : "GET");

    headers.set(callHeader, id);
    calls.set(id, `${method} ${isRequest ? input.url : String(input)}`);

    const answer = fetch(input, { ...init, headers });
    const settled = () => calls.delete(id);

    answer.then(settled, settled);

    return answer;
  };
}

/** The next turn of the event loop, after every microtask queued before it. */
function nextTurn(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** How long a call may take to reach msw before `unhandledCalls` gives up on it. */
const reachWithinMs = 5_000;

/**
 * The calls no handler answered since the last time, which are then forgotten: once every call made so far reached
 * msw, or settled, and msw looked up its handlers. A lookup awaits only the handlers' own checks, no I/O: the turn after
 * the last call reached msw holds its verdict. A handler that never answers, and a stream left open, do not hold it up.
 *
 * @throws When a call has not reached msw nor settled within 5 seconds, naming it.
 */
export async function unhandledCalls(): Promise<string[]> {
  const deadline = Date.now() + reachWithinMs;

  while (calls.size > 0) {
    if (Date.now() > deadline) {
      throw new Error(`these calls reached no handler and did not settle: ${[...calls.values()].join(", ")}`);
    }

    await nextTurn();
  }

  await nextTurn();

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
