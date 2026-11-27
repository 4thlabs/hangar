import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { AppProviders } from "#app-providers.tsx";
import { createPage } from "#page.ts";

/** An `EventSource` the test drives: each one the page opens is kept, which the test opens and sends items on. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  /** Every source opened since `stubEventSource`. */
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

/**
 * Puts `FakeEventSource` in place of `EventSource`, its sources forgotten, for a test that drives a lost stream and its
 * reconnection, which msw's `sse()` does not: the rest is answered by the network. `vi.unstubAllGlobals()` undoes it.
 */
export function stubEventSource() {
  FakeEventSource.sources = [];
  vi.stubGlobal("EventSource", FakeEventSource);
}

/** The page at `path`, with the preferences the cookies hold. */
export function renderAt(path: string) {
  const { queryClient, router, preferences } = createPage({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(
    <AppProviders queryClient={queryClient} preferences={preferences}>
      <RouterProvider router={router} />
    </AppProviders>,
  );

  return router;
}
