import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { RepeatedLineFilter } from "#modules/cluster/repeated-line-filter.ts";

/** What the filter lets through of these chunks, written in order. */
const filtered = (chunks: string[]) =>
  text(Readable.from(chunks.map(chunk => Buffer.from(chunk))).pipe(new RepeatedLineFilter()));

describe("RepeatedLineFilter", () => {
  it("keeps one line of each run of identical ones, as docker stack deploy repeats its progress", async () => {
    const output = await filtered([
      "Creating service whoami_whoami\noverall progress: 0 out of 2 tasks\n",
      "overall progress: 0 out of 2 tasks\noverall progress: 0 out of 2 tasks\n",
      "overall progress: 2 out of 2 tasks\nverify: Service converged\n",
    ]);

    expect(output).toBe(
      "Creating service whoami_whoami\noverall progress: 0 out of 2 tasks\noverall progress: 2 out of 2 tasks\nverify: Service converged\n",
    );
  });

  it("compares whole lines, even when a chunk cuts one in two", async () => {
    expect(await filtered(["verify: Waiting 5 sec", "onds\nverify: Waiting 5 seconds\nverify: Wait"])).toBe(
      "verify: Waiting 5 seconds\nverify: Wait",
    );
  });

  it("keeps a line that comes back after another one", async () => {
    expect(await filtered(["1/2: running\n2/2: running\n1/2: running\n"])).toBe(
      "1/2: running\n2/2: running\n1/2: running\n",
    );
  });
});
