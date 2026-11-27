import { describe, expect, it } from "vitest";
import { createVitest } from "vitest/node";
import { getHealthCheckMockHandler } from "#libs/api/mock";
import { network } from "#mock/network.ts";

/**
 * How the Vitest file `path` ended, run with the suite's own config and setup: each test by name, then the errors of the
 * file itself, as of its `afterAll`.
 */
async function outcomes(path: string) {
  const vitest = await createVitest("test", {
    watch: false,
    include: [path],
    reporters: [],
    silent: true,
    provide: { isUnhandledCallsFixture: true },
  });

  try {
    await vitest.start([path]);

    const files = vitest.state.getFiles();

    return {
      tests: Object.fromEntries(files.flatMap(file => file.tasks).map(task => [task.name, task.result?.state])),
      fileErrors: files.flatMap(file => file.result?.errors ?? []).map(error => error.message),
    };
  } finally {
    await vitest.close();
  }
}

describe("the tests' network", () => {
  // A call is checked at the first check after it is made: its own test's, then the next test's, then the file's.
  it("fails the first check after a call no handler answers: its test's, the next test's, or its file's", async () => {
    const { tests, fileErrors } = await outcomes("src/mock/unhandled-calls.fixture.ts");

    expect(tests).toEqual({
      "awaits a call no handler answers, whose failure it catches": "fail",
      "makes a call no handler answers as its last line": "fail",
      "makes a call a handler answers": "pass",
      "reads with a query no handler answers, which its unmount aborts": "fail",
      // A timer's call comes after its test's check: the next test's fails.
      "starts a timer of 0 ms whose call no handler answers": "pass",
      "waits 1 ms after that timer": "fail",
      "starts a timer of 30 ms whose call no handler answers": "pass",
      "waits 50 ms after that timer": "fail",
      "makes a call no handler answers as its last line, the last test of its file": "fail",
    });

    expect(fileErrors).toEqual([
      "no handler was in place when the page made 1 call(s) after the last test's check: GET /api/health?after=all",
    ]);
  }, 60_000);

  it("answers a call a test adds a handler for", async () => {
    network.use(getHealthCheckMockHandler({ version: "0.1.0" }));

    const answer = await fetch("/api/health");

    expect(await answer.json()).toEqual({ version: "0.1.0" });
  });

  it("answers what the shell calls on every page with no handler of the test's", async () => {
    const session = await fetch("/api/auth/session");
    const bell = await fetch("/api/notifications");

    expect(await session.json()).toEqual({ name: "Ana Lima", email: "ana@example.com" });
    expect(await bell.json()).toEqual({ epoch: "first", notifications: [] });
  });
});
