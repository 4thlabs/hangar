// The tests `network.test.ts` runs through Vitest's Node API, to check that `setup.ts` fails the test that made a call
// no handler answers, wherever the call is: not collected by the suite, as its name is not `*.test.ts`.
import { it } from "vitest";
import { getHealthCheckMockHandler } from "#libs/api/mock";
import { network } from "#mock/network.ts";

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

it("makes a call no handler answers as its last line, the last test of its file", () => {
  void fetch("/api/health").catch(() => undefined);
});
