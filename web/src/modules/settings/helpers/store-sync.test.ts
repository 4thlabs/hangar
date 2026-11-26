import { describe, expect, it } from "vitest";
import type { StoreSync } from "#libs/api";
import { describeSync } from "./store-sync.ts";

const update: StoreSync = {
  operation: "update",
  state: "running",
  startedAt: "2026-11-26T10:00:00.000Z",
  finishedAt: null,
  error: null,
};

describe("describeSync", () => {
  it("says a sync runs", () => {
    expect(describeSync(update)).toBe("Updating the store…");
    expect(describeSync({ ...update, operation: "install" })).toBe("Installing the store…");
  });

  it("says when a sync ended well", () => {
    const ended = describeSync({ ...update, state: "succeeded", finishedAt: "2026-11-26T10:00:05.000Z" });

    expect(ended).toMatch(/^The store was updated on Nov 26, 2026, \d{1,2}:\d{2}\s[AP]M\.$/);
  });

  it("says why a sync failed", () => {
    const failed: StoreSync = {
      ...update,
      state: "failed",
      error: { code: "store.pull_failed", message: "the store could not be pulled. See the server's log." },
    };

    expect(describeSync(failed)).toBe(
      "The update of the store failed: The store could not be pulled. See the server's log.",
    );
  });
});
