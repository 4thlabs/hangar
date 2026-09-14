import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
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

  it("keeps the output of a captured run that exited non-zero", async () => {
    const runtime = new Runtime();
    // What `docker inspect` does when one id of several is gone: usable output, failing code.
    const script = "console.log('partial'); process.exit(1)";

    await expect(runtime.run("node", ["-e", script], { capture: true })).resolves.toMatchObject({
      code: 1,
      stdout: "partial\n",
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
