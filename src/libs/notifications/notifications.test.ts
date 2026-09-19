import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
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

  it("files a notification for the named user only", async () => {
    await notifications.notify({ userId: "alice", level: "success", title: "Up terminé" });

    expect(await notifications.list("alice")).toMatchObject([{ title: "Up terminé", level: "success", read: false }]);
    expect(await notifications.list("bob")).toEqual([]);
  });

  it("fans a system event out to every account", async () => {
    await notifications.notify({ title: "Mises à jour disponibles" });

    expect(await notifications.list("alice")).toHaveLength(1);
    expect(await notifications.list("bob")).toHaveLength(1);
  });

  it("replaces a previous notification carrying the same dedupe key", async () => {
    await notifications.notify({ userId: "alice", title: "1 mise à jour", dedupeKey: "image-updates" });
    await notifications.notify({ userId: "alice", title: "3 mises à jour", dedupeKey: "image-updates" });
    await notifications.notify({ userId: "alice", title: "Sans clé" });

    expect(await notifications.list("alice")).toMatchObject([{ title: "Sans clé" }, { title: "3 mises à jour" }]);
  });

  it("keeps only the newest notifications", async () => {
    for (let index = 0; index < 55; index += 1) {
      await notifications.notify({ userId: "alice", title: `Commande ${index}` });
    }

    const kept = await notifications.list("alice", 100);

    expect(kept).toHaveLength(50);
    expect(kept.at(0)).toMatchObject({ title: "Commande 54" });
    expect(kept.at(-1)).toMatchObject({ title: "Commande 5" });
  });

  it("files an already-shown notification without asking for a toast", async () => {
    await notifications.notify({ userId: "alice", title: "Déjà vue", seen: true });

    expect(await notifications.list("alice")).toMatchObject([{ seen: true, read: false }]);
  });

  it("marks notifications seen and read without touching another user's", async () => {
    await notifications.notify({ title: "Commune" });
    const [alice] = await notifications.list("alice");

    await notifications.markSeen("alice", [alice!.id]);
    await notifications.markRead("alice");

    expect(await notifications.list("alice")).toMatchObject([{ seen: true, read: true }]);
    expect(await notifications.list("bob")).toMatchObject([{ seen: false, read: false }]);
  });

  it("reads from the cursor forward, inclusively", async () => {
    await notifications.notify({ userId: "alice", title: "Ancienne" });
    const [ancienne] = await notifications.list("alice");
    const filedAt = ancienne!.createdAt;

    // Inclusive on purpose: several notifications share a millisecond, so the stream asks again
    // from the last instant it saw and drops the ids it already holds. Losing one is worse than
    // sending one twice.
    expect(await notifications.since("alice", new Date(filedAt))).toMatchObject([{ title: "Ancienne" }]);
    expect(await notifications.since("alice", new Date(filedAt + 1))).toEqual([]);
  });
});
