import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDb } from "#libs/db";
import { Notifications } from "./notifications.ts";

vi.mock("#libs/logs", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

// A real SQLite rather than a stubbed query builder: fan-out, dedupe and retention are SQL, and
// a fake handle would only assert the statements were written the way they were written. The
// class takes its handle by injection, so there is no module to mock.
const database = migrateDb(":memory:");
const notifications = new Notifications(database);

const seedUser = (id: string) =>
  database.run(sql`insert into user (id, name, email, email_verified) values (${id}, ${id}, ${`${id}@test`}, 0)`);

describe("Notifications", () => {
  beforeEach(() => {
    database.run(sql`delete from notification`);
    database.run(sql`delete from user`);
    seedUser("alice");
    seedUser("bob");
  });

  it("files a key and its parameters, in no language", () => {
    expect(Notifications.message("updatesAvailable", { count: 2 })).toEqual({
      key: "updatesAvailable",
      params: { count: 2 },
    });

    expect(Notifications.message("storeInstalled")).toEqual({ key: "storeInstalled", params: {} });
  });

  it("keeps the message's key and parameters for the reader's language to render", async () => {
    const message = { key: "backupFailed", params: { app: "immich", error: "disk full" } };

    await notifications.notify({ userId: "alice", message });

    expect(await notifications.list("alice")).toMatchObject([{ message, title: "backupFailed", description: null }]);
  });

  it("files a notification for the named user only", async () => {
    await notifications.notify({ userId: "alice", level: "success", message: { key: "composeSucceeded", params: {} } });

    expect(await notifications.list("alice")).toMatchObject([
      { message: { key: "composeSucceeded", params: {} }, level: "success", read: false },
    ]);

    expect(await notifications.list("bob")).toEqual([]);
  });

  it("fans a system event out to every account", async () => {
    await notifications.notify({ message: { key: "updatesAvailable", params: {} } });

    expect(await notifications.list("alice")).toHaveLength(1);
    expect(await notifications.list("bob")).toHaveLength(1);
  });

  it("replaces a previous notification carrying the same dedupe key", async () => {
    await notifications.notify({
      userId: "alice",
      message: { key: "firstRun", params: {} },
      dedupeKey: "image-updates",
    });

    await notifications.notify({
      userId: "alice",
      message: { key: "secondRun", params: {} },
      dedupeKey: "image-updates",
    });

    await notifications.notify({ userId: "alice", message: { key: "undeduped", params: {} } });

    expect(await notifications.list("alice")).toMatchObject([{ title: "undeduped" }, { title: "secondRun" }]);
  });

  it("keeps only the newest notifications", async () => {
    for (let index = 0; index < 55; index += 1) {
      await notifications.notify({ userId: "alice", message: { key: `command-${index}`, params: {} } });
    }

    const kept = await notifications.list("alice", 100);

    expect(kept).toHaveLength(50);
    expect(kept.at(0)).toMatchObject({ title: "command-54" });
    expect(kept.at(-1)).toMatchObject({ title: "command-5" });
  });

  it("files an already-shown notification without asking for a toast", async () => {
    await notifications.notify({ userId: "alice", message: { key: "alreadySeen", params: {} }, seen: true });

    expect(await notifications.list("alice")).toMatchObject([{ seen: true, read: false }]);
  });

  it("marks notifications seen and read without touching another user's", async () => {
    await notifications.notify({ message: { key: "shared", params: {} } });
    const [alice] = await notifications.list("alice");

    await notifications.markSeen("alice", [alice!.id]);
    await notifications.markRead("alice");

    expect(await notifications.list("alice")).toMatchObject([{ seen: true, read: true }]);
    expect(await notifications.list("bob")).toMatchObject([{ seen: false, read: false }]);
  });

  it("reads from the cursor forward, inclusively", async () => {
    await notifications.notify({ userId: "alice", message: { key: "older", params: {} } });
    const [ancienne] = await notifications.list("alice");
    const filedAt = ancienne!.createdAt;

    // Inclusive on purpose: several notifications share a millisecond, so the stream asks again
    // from the last instant it saw and drops the ids it already holds. Losing one is worse than
    // sending one twice.
    expect(await notifications.since("alice", new Date(filedAt))).toMatchObject([{ title: "older" }]);
    expect(await notifications.since("alice", new Date(filedAt + 1))).toEqual([]);
  });
});
