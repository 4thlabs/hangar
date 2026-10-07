import { and, desc, eq, gte, inArray, isNull, notInArray, sql, type AnyRelations } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { notification, user, type Notification } from "#libs/db";
import { logger } from "#libs/logs";

export type NotificationLevel = Notification["level"];

export type NotificationInput = {
  /** Recipient. Omitted, the notification fans out to every account. */
  userId?: string;
  level?: NotificationLevel;
  title: string;
  description?: string;
  /** Where clicking the notification goes, e.g. `/apps/immich`. */
  href?: string;
  /** Replaces this recipient's previous notification carrying the same key. */
  dedupeKey?: string;
  /** Already shown to the user by the caller — file it without toasting it again. */
  seen?: boolean;
};

/**
 * What the client gets: timestamps flattened to what it actually uses. The row's dates would
 * otherwise reach the browser as `Date` through RSC and as a string through the SSE stream,
 * which is the same data in two shapes.
 */
export type NotificationPayload = {
  id: string;
  level: NotificationLevel;
  title: string;
  description: string | null;
  href: string | null;
  /** Already shown as a toast. */
  seen: boolean;
  /** Already opened in the notification centre; an unread one counts towards the badge. */
  read: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
};

/**
 * The notification centre's store: one row per recipient, so `seen`/`read` need no join table.
 * Generic over the relations it never uses, so a test can pass a bare in-memory database.
 *
 * No `server-only` guard: see AGENTS.md § server-only.
 */
export class Notifications<TRelations extends AnyRelations = AnyRelations> {
  /**
   * How many notifications a user keeps; older ones are dropped on the next insert.
   * ponytail: a fixed count, not an age-based sweep.
   */
  private static readonly Retained = 50;

  /** How many are handed to the navbar on a page render, and how many one stream frame carries. */
  private static readonly Page = 30;

  /** Ties on `created_at` (a batch shares one millisecond) are broken by insertion order. */
  private static readonly NewestFirst = [desc(notification.createdAt), sql`rowid desc`];

  /** Oldest first, with the same insertion-order tie-break as {@link Notifications.NewestFirst}. */
  private static readonly OldestFirst = [notification.createdAt, sql`rowid asc`];

  private readonly db: BetterSQLite3Database<TRelations>;

  constructor(db: BetterSQLite3Database<TRelations>) {
    this.db = db;
  }

  /**
   * Files a notification for one user, or for every account when `userId` is omitted.
   *
   * Never throws: a notification is a report about some other piece of work, and failing to
   * write it must not fail the work it describes. Callers `await` it only to keep their order.
   * @param input What to tell whom
   */
  async notify(input: NotificationInput): Promise<void> {
    try {
      const targets = await this.recipients(input.userId);

      if (targets.length === 0) {
        return;
      }

      const now = new Date();

      for (const userId of targets) {
        // Delete then insert rather than update: a recurring notification whose content changed
        // must resurface at the top of the list, not sit where the stale one was.
        if (input.dedupeKey) {
          await this.db
            .delete(notification)
            .where(and(eq(notification.userId, userId), eq(notification.dedupeKey, input.dedupeKey)));
        }

        await this.db.insert(notification).values({
          userId,
          level: input.level ?? "info",
          title: input.title,
          description: input.description ?? null,
          href: input.href ?? null,
          dedupeKey: input.dedupeKey ?? null,
          seenAt: input.seen ? now : null,
          createdAt: now,
        });

        await this.purge(userId);
      }
    } catch (error) {
      logger.error("Failed to record a notification", { error, title: input.title });
    }
  }

  /**
   * A user's newest notifications, newest first.
   * @param limit How many to return at most
   */
  async list(userId: string, limit = Notifications.Page): Promise<NotificationPayload[]> {
    try {
      const rows = await this.db
        .select()
        .from(notification)
        .where(eq(notification.userId, userId))
        .orderBy(...Notifications.NewestFirst)
        .limit(limit);

      return rows.map(Notifications.toPayload);
    } catch (error) {
      logger.error("Failed to read notifications", { error, userId });

      return [];
    }
  }

  /**
   * Everything filed for this user at or after `cursor`, oldest first.
   *
   * The bound is inclusive because two inserts can land in the same millisecond; the caller
   * drops the ids it already holds.
   * @param cursor The instant to read from
   */
  async since(userId: string, cursor: Date): Promise<NotificationPayload[]> {
    const rows = await this.db
      .select()
      .from(notification)
      .where(and(eq(notification.userId, userId), gte(notification.createdAt, cursor)))
      .orderBy(...Notifications.OldestFirst)
      .limit(Notifications.Page);

    return rows.map(Notifications.toPayload);
  }

  /**
   * Marks notifications as shown in a toast, so a later page load does not toast them again.
   * @param ids The notifications that were just toasted
   */
  async markSeen(userId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    try {
      await this.db
        .update(notification)
        .set({ seenAt: new Date() })
        .where(and(eq(notification.userId, userId), inArray(notification.id, ids), isNull(notification.seenAt)));
    } catch (error) {
      logger.error("Failed to mark notifications as seen", { error, userId });
    }
  }

  /** Marks every unread notification as read, clearing the bell's badge. */
  async markRead(userId: string): Promise<void> {
    try {
      await this.db
        .update(notification)
        .set({ readAt: new Date() })
        .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
    } catch (error) {
      logger.error("Failed to mark notifications as read", { error, userId });
    }
  }

  /**
   * Who a notification goes to: the one named, or everyone when none was.
   */
  private async recipients(userId: string | undefined): Promise<string[]> {
    if (userId) {
      return [userId];
    }

    const accounts = await this.db.select({ id: user.id }).from(user);

    return accounts.map(account => account.id);
  }

  /**
   * Drops everything past the {@link Notifications.Retained} newest for one user.
   */
  private async purge(userId: string): Promise<void> {
    await this.db.delete(notification).where(
      and(
        eq(notification.userId, userId),
        notInArray(
          notification.id,
          this.db
            .select({ id: notification.id })
            .from(notification)
            .where(eq(notification.userId, userId))
            .orderBy(...Notifications.NewestFirst)
            .limit(Notifications.Retained),
        ),
      ),
    );
  }

  /**
   * A row as the browser reads it.
   */
  private static toPayload(row: Notification): NotificationPayload {
    return {
      id: row.id,
      level: row.level,
      title: row.title,
      description: row.description,
      href: row.href,
      seen: row.seenAt !== null,
      read: row.readAt !== null,
      createdAt: row.createdAt.getTime(),
    };
  }
}
