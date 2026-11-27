import { describe, expect, it } from "vitest";
import { getHealthCheckMockHandler } from "#libs/api/mock";
import { network, takeUnhandledCalls } from "#mock/network.ts";

describe("the tests' network", () => {
  it("fails a call no handler answers, and keeps it to fail its test, even when the page catches the failure", async () => {
    const answer = await fetch("/api/health").catch((error: unknown) => error);

    expect(answer).toBeInstanceOf(Error);
    // Taken, so that this test passes: `setup.ts` fails any other with what msw says here.
    expect(takeUnhandledCalls()).toEqual([expect.stringContaining("GET /api/health")]);
  });

  it("answers a call a test adds a handler for, and keeps nothing", async () => {
    network.use(getHealthCheckMockHandler({ version: "0.1.0" }));

    const answer = await fetch("/api/health");

    expect(await answer.json()).toEqual({ version: "0.1.0" });
    expect(takeUnhandledCalls()).toEqual([]);
  });

  it("answers what the shell calls on every page with no handler of the test's", async () => {
    const session = await fetch("/api/auth/session");
    const bell = await fetch("/api/notifications");

    expect(await session.json()).toEqual({ name: "Ana Lima", email: "ana@example.com" });
    expect(await bell.json()).toEqual({ epoch: "first", notifications: [] });
  });
});
