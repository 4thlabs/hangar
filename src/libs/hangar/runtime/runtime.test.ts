import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "./runtime.ts";

describe("runtime run", () => {
  // it("pipes stdout and stderr to a shared output stream without ending it", async () => {
  //   const output = new PassThrough();
  //   let received = "";

  //   output.setEncoding("utf8");
  //   output.on("data", chunk => {
  //     received += chunk;
  //   });

  //   await expect(
  //     run(
  //       process.execPath,
  //       { output },
  //       "-e",
  //       'process.stdout.write("standard output"); process.stderr.write("standard error");',
  //     ),
  //   ).resolves.toEqual({ code: 0 });

  //   expect(received).toContain("standard output");
  //   expect(received).toContain("standard error");
  //   expect(output.writableEnded).toBe(false);

  //   output.destroy();
  // });

  it("keeps the existing variadic arguments signature", async () => {
    await expect(run(process.execPath, "-e", "process.exit(0)")).resolves.toEqual({ code: 0 });
  });
});
