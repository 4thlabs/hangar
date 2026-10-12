import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth/server", () => ({ sessions: { get: vi.fn() } }));

const { apiCommandStream } = await import("#app/api/api-route.ts");

/** A command printing about 1 MB, well past what a pipe buffers. */
const VERBOSE_COMMAND = ["-e", "for (let i = 0; i < 20000; i++) console.log('x'.repeat(50))"];

describe("apiCommandStream", () => {
  it("streams what the commands write, then ends", async () => {
    const response = apiCommandStream(async output => {
      output.write("$ docker compose up -d\n");
      output.end("done\n");
    });

    await expect(response.text()).resolves.toBe("$ docker compose up -d\ndone\n");
  });

  it("lets a verbose command run to its end once the page is closed", async () => {
    const pageClosed = Promise.withResolvers<void>();
    const exited = Promise.withResolvers<number | null>();

    const response = apiCommandStream(async output => {
      await pageClosed.promise;

      const child = spawn(process.execPath, VERBOSE_COMMAND, { stdio: ["ignore", "pipe", "inherit"] });

      // As `Runtime.run` hands a child's output to the stream.
      child.stdout.pipe(output, { end: false });
      child.on("exit", exited.resolve);
    });

    await response.body?.cancel(new Error("page closed"));
    pageClosed.resolve();

    // Handed the response itself, the child would block on its unread output and never exit.
    await expect(exited.promise).resolves.toBe(0);
  }, 10_000);
});
