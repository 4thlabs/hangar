import { PassThrough } from "node:stream";
import { text } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { CommandStream } from "#modules/common/command-stream.ts";

describe("CommandStream", () => {
  it("reads back the failure count the stream was ended with", async () => {
    const output = new PassThrough();

    output.write("$ docker stack deploy\nCreating service whoami_whoami\n");
    CommandStream.end(output, 2);

    expect(CommandStream.exitCode(await text(output))).toBe(2);
  });

  it("has no exit code while the command still runs", () => {
    expect(CommandStream.exitCode("Creating service whoami_whoami\n")).toBeNull();
  });
});
