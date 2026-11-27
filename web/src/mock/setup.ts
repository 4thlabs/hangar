import nodeConsole from "node:console";
import { EventSource } from "eventsource";
import { afterAll, afterEach, beforeAll, inject } from "vitest";

// happy-dom has no `EventSource`, which the page's feeds open and msw's `sse()` answers. This one is on `fetch`, which
// msw intercepts. Set, not stubbed, so that `vi.unstubAllGlobals()` gives it back after a test that stubs its own.
globalThis.EventSource ??= EventSource;

// Imported once `EventSource` is there: msw's `sse()` refuses to build its handler without one, and a static import
// would run before the line above.
const { network, trackedFetch, unhandledCalls } = await import("#mock/network.ts");

/** A hang-up, as Node names the error of a request destroyed before its answer. */
function isHangUp(value: unknown): boolean {
  return value instanceof Error && value.message === "socket hang up" && "code" in value && value.code === "ECONNRESET";
}

declare module "vitest" {
  interface ProvidedContext {
    /** Set by `network.test.ts` for the fixture it runs, whose calls no handler answers on purpose. */
    isUnhandledCallsFixture: boolean;
  }
}

/** msw's rejection of a call no handler answers, under its `"error"` strategy. */
function isUnhandledRejection(value: unknown): boolean {
  return value instanceof Error && value.name === "InternalError" && value.message.includes('the "error" strategy');
}

// happy-dom prints the error of every request its `fetch` ends, a request the page aborted included: as a stream
// closes on unmount, or a read is cancelled. It prints on Node's own console, which Vitest gave it, with no test's name.
// msw answers every call in the process, so a hang-up there can only be such an abort, and it would bury a real error.
// Only that one is left out, and only on the console happy-dom prints on: the tests' own is Vitest's. In the fixture
// of `network.test.ts`, msw's rejections of its calls are left out too: they are its point, and its runner checks them.
const printError = nodeConsole.error.bind(nodeConsole);
const isFixture = inject("isUnhandledCallsFixture") === true;

nodeConsole.error = (...data: unknown[]) => {
  const [error] = data;
  const isExpected = isHangUp(error) || (isFixture && isUnhandledRejection(error));

  if (data.length === 1 && isExpected) {
    return;
  }

  printError(...data);
};

/** Puts `fetch` in place as the global one, as msw does: a value of its own, which it can replace again. */
function setFetch(fetch: typeof globalThis.fetch) {
  Object.defineProperty(globalThis, "fetch", { value: fetch, enumerable: true, configurable: true, writable: true });
}

const pageFetch = globalThis.fetch;

// msw's "error" rejects a call no handler answers, and prints why: a page shows it as a failed card, and its test
// would pass. Each call is checked against the handlers as the page makes it, above msw's own patch of `fetch`.
beforeAll(() => {
  network.listen({ onUnhandledFrame: "error" });
  setFetch(trackedFetch(globalThis.fetch));
});

/** Fails, naming `calls`, when there are any. */
function failOn(calls: readonly string[], when: string) {
  if (calls.length > 0) {
    throw new Error(`no handler was in place when the page made ${calls.length} call(s) ${when}: ${calls.join(", ")}`);
  }
}

// After the test's own hooks, which run first and unmount its page: every call made since the last check, the ones
// the unmount aborted included, fails the test.
afterEach(async () => {
  try {
    failOn(await unhandledCalls(), "since the last check");
  } finally {
    network.resetHandlers();
  }
});

// A call made after the last test's check, as in the file's own `afterAll`, which runs before this one, fails the file.
// One made after this one, as by a timer of the page, is checked by nothing.
afterAll(async () => {
  try {
    failOn(await unhandledCalls(), "after the last test's check");
  } finally {
    network.close();
    setFetch(pageFetch);
  }
});
