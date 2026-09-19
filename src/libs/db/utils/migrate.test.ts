import { expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { migrateDb } from "./migrate.ts";

// Guards the committed SQL in `src/drizzle`, not drizzle's migrator: a schema change
// with no generated migration leaves the container booting without its tables.
test("the committed migrations create every table the app reads", () => {
  const db = migrateDb(":memory:");
  const tables = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`);

  expect(tables.map(table => table.name)).toEqual(
    expect.arrayContaining(["user", "session", "account", "verification", "notification"]),
  );
});
