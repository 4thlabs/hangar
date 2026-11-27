// The tests `network.test.ts` runs through Vitest's Node API, to check where `setup.ts` fails a call no handler
// answers: at the first check after it is made. Not collected by the suite, as its name is not `*.test.ts`.
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterAll, afterEach, it } from "vitest";
import { getHealthCheckMockHandler } from "#libs/api/mock";
import { network } from "#mock/network.ts";

afterEach(() => {
  cleanup();
});

// After the last test's check, before the setup's own `afterAll`, which runs after this file's.
afterAll(() => {
  void fetch("/api/health?after=all").catch(() => undefined);
});

it("awaits a call no handler answers, whose failure it catches", async () => {
  await fetch("/api/health").catch(() => undefined);
});

it("makes a call no handler answers as its last line", () => {
  void fetch("/api/health").catch(() => undefined);
});

it("makes a call a handler answers", async () => {
  network.use(getHealthCheckMockHandler({ version: "0.1.0" }));

  await fetch("/api/health");
});

it("reads with a query no handler answers, which its unmount aborts", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

  renderHook(() => useQuery({ queryKey: ["health"], queryFn: ({ signal }) => fetch("/api/health", { signal }) }), {
    wrapper,
  });
});

it("starts a timer of 0 ms whose call no handler answers", () => {
  setTimeout(() => void fetch("/api/health?timer=0").catch(() => undefined), 0);
});

it("waits 1 ms after that timer", async () => {
  await new Promise(resolve => setTimeout(resolve, 1));
});

it("starts a timer of 30 ms whose call no handler answers", () => {
  setTimeout(() => void fetch("/api/health?timer=30").catch(() => undefined), 30);
});

it("waits 50 ms after that timer", async () => {
  await new Promise(resolve => setTimeout(resolve, 50));
});

it("makes a call no handler answers as its last line, the last test of its file", () => {
  void fetch("/api/health").catch(() => undefined);
});
