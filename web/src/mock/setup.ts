import { EventSource } from "eventsource";
import { afterAll, afterEach, beforeAll } from "vitest";

// happy-dom has no `EventSource`, which the page's feeds open and msw's `sse()` answers. This one is on `fetch`, which
// msw intercepts. Set, not stubbed, so that `vi.unstubAllGlobals()` gives it back after a test that stubs its own.
globalThis.EventSource ??= EventSource;

// Imported once `EventSource` is there: msw's `sse()` refuses to build its handler without one, and a static import
// would run before the line above.
const { keepUnhandled, network, takeUnhandledCalls } = await import("#mock/network.ts");

beforeAll(() => network.listen({ onUnhandledFrame: keepUnhandled }));

// After the test's own hooks, which run first and unmount its page: a call no handler answered fails the test.
afterEach(() => {
  network.resetHandlers();

  const calls = takeUnhandledCalls();

  if (calls.length > 0) {
    throw new Error(`no handler answered ${calls.length} call(s) of this test:\n\n${calls.join("\n\n")}`);
  }
});

afterAll(() => network.close());
