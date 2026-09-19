import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.ts";

/**
 * One row per recipient, not per event: a system-wide event fans out at insertion time, so
 * `seen_at` and `read_at` live on the row and no join table is needed to tell who read what.
 *
 * No `defineRelationsPart` here: notifications are only ever queried by `user_id`, and a part
 * redefining `user` would clobber `authRelations` where `connection.ts` spreads them.
 */
export const notification = sqliteTable(
  "notification",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Same values as the toast `type`, so the client passes it straight through. */
    level: text("level", { enum: ["success", "error", "warning", "info"] })
      .notNull()
      .default("info"),
    title: text("title").notNull(),
    description: text("description"),
    /** Where the notification points, e.g. `/apps/immich`. */
    href: text("href"),
    /** Recurring notifications overwrite their previous row instead of stacking up. */
    dedupeKey: text("dedupe_key"),
    /** Set once the notification has been shown as a toast. */
    seenAt: integer("seen_at", { mode: "timestamp_ms" }),
    /** Set once the user opened the notification centre. Drives the bell's badge. */
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  table => [index("notification_userId_createdAt_idx").on(table.userId, table.createdAt)],
);

export type Notification = typeof notification.$inferSelect;
