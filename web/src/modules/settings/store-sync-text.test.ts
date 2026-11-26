import { describe, expect, it } from "vitest";
import type { StoreSync } from "#libs/api";
import { StoreSyncText } from "./store-sync-text.ts";

const update: StoreSync = {
  operation: "update",
  state: "running",
  startedAt: "2026-11-26T10:00:00.000Z",
  finishedAt: null,
  error: null,
};

describe("StoreSyncText.of", () => {
  it("says a sync runs", () => {
    expect(StoreSyncText.of(update)).toBe("Updating the store…");
    expect(StoreSyncText.of({ ...update, operation: "install" })).toBe("Installing the store…");
  });

  it("says when a sync ended well", () => {
    const ended = StoreSyncText.of({ ...update, state: "succeeded", finishedAt: "2026-11-26T10:00:05.000Z" });

    expect(ended).toMatch(/^The store was updated on Nov 26, 2026, \d{1,2}:\d{2}\s[AP]M\.$/);
  });

  it("says why a sync failed", () => {
    const failed = {
      ...update,
      state: "failed",
      error: "The store could not be pulled. See the server's log.",
    } as const;

    expect(StoreSyncText.of(failed)).toBe(
      "The update of the store failed: The store could not be pulled. See the server's log.",
    );
  });
});
