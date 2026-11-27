import { describe, expect, it } from "vitest";
import { createVitest } from "vitest/node";
import { getHealthCheckMockHandler } from "#libs/api/mock";
import { network } from "#mock/network.ts";

/** How each test of the Vitest file `path` ended, by name, run with the suite's own config and setup. */
async function outcomes(path: string): Promise<Record<string, string | undefined>> {
  const vitest = await createVitest("test", { watch: false, include: [path], reporters: [], silent: true });

  try {
    await vitest.start([path]);

    return Object.fromEntries(
      vitest.state
        .getFiles()
        .flatMap(file => file.tasks)
        .map(task => [task.name, task.result?.state]),
    );
  } finally {
    await vitest.close();
  }
}

describe("the tests' network", () => {
  it("fails the test that made a call no handler answers, awaited or not, the last of its file included", async () => {
    expect(await outcomes("src/mock/unhandled-calls.fixture.ts")).toEqual({
      "awaits a call no handler answers, whose failure it catches": "fail",
      "makes a call no handler answers as its last line": "fail",
      "makes a call a handler answers": "pass",
      "makes a call no handler answers as its last line, the last test of its file": "fail",
    });
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
