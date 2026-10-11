import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { Runtime } from "./runtime.ts";

const collect = (stream: PassThrough) => {
  let text = "";

  stream.on("data", (chunk: Buffer) => (text += chunk.toString()));

  return () => text;
};

describe("Runtime", () => {
  it("pipes stdout and stderr of several runs into one stream", async () => {
    const runtime = new Runtime();
    const output = new PassThrough();
    const text = collect(output);

    await runtime.run("node", ["-e", "console.log('first')"], { pipe: output });
    await runtime.run("node", ["-e", "console.error('second')"], { pipe: output });

    // The stream survives the first child: a multi-stack compose shares it.
    expect(output.writableEnded).toBe(false);
    expect(text()).toContain("first");
    expect(text()).toContain("second");
  });

  it("rejects with the child exit code", async () => {
    const runtime = new Runtime();
    const output = new PassThrough();

    await expect(runtime.run("node", ["-e", "process.exit(3)"], { pipe: output })).rejects.toMatchObject({ code: 3 });
  });

  it("captures stdout without letting stderr contaminate it", async () => {
    const runtime = new Runtime();
    const script = "console.error('noise'); console.log('{\"ok\":true}')";

    const result = await runtime.run("node", ["-e", script], { capture: true });

    expect(result.stdout.trim()).toBe('{"ok":true}');
    expect(result.stdout).not.toContain("noise");
  });

  it("fails a captured run on a non-zero exit, even one that printed something", async () => {
    const runtime = new Runtime();
    const script = "console.log('Creating service web'); console.error('network conflict'); process.exit(1)";

    await expect(runtime.run("node", ["-e", script], { capture: true })).rejects.toMatchObject({
      code: 1,
      message: "network conflict",
    });
  });

  it("reports the end of stderr when a piped run fails", async () => {
    const runtime = new Runtime();
    const output = new PassThrough();
    const script = "console.log('Creating service web'); console.error('this node is not a manager'); process.exit(1)";

    await expect(runtime.run("node", ["-e", script], { pipe: output })).rejects.toMatchObject({
      message: "this node is not a manager",
    });
  });

  it("rejects a captured run that produced nothing, reporting stderr", async () => {
    const runtime = new Runtime();
    const script = "console.error('daemon down'); process.exit(1)";

    await expect(runtime.run("node", ["-e", script], { capture: true })).rejects.toMatchObject({
      code: 1,
      message: "daemon down",
    });
  });

  it("keeps only the end of a long stderr, where the cause is", async () => {
    const runtime = new Runtime();

    // `exitCode`, not `exit()`: exiting at once would cut the piped stderr short.
    const script =
      "for (let i = 0; i < 5000; i++) console.error('progress ' + i); console.error('disk full'); process.exitCode = 1";

    const failure = await runtime.run("node", ["-e", script], { capture: true }).catch((error: Error) => error);

    expect(failure).toMatchObject({ message: expect.stringMatching(/progress 4999\ndisk full$/) });
    expect((failure as Error).message.split("\n")).toHaveLength(20);
  });

  it("sets the given variables over its own environment", async () => {
    const runtime = new Runtime();
    const script = "console.log(process.env.HANGAR_TEST_VAR, Boolean(process.env.PATH))";

    const { stdout } = await runtime.run("node", ["-e", script], { capture: true, env: { HANGAR_TEST_VAR: "set" } });

    expect(stdout.trim()).toBe("set true");
  });

  it("kills the child when the signal is aborted", async () => {
    const runtime = new Runtime();
    const output = new PassThrough();
    const controller = new AbortController();

    const run = runtime.run("node", ["-e", "setInterval(() => {}, 1000)"], {
      pipe: output,
      signal: controller.signal,
    });

    controller.abort();

    await expect(run).rejects.toBeInstanceOf(Error);
  });
});
