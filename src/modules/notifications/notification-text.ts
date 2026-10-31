import type { NotificationMessage } from "#libs/db";
import type { NotificationPayload } from "#libs/notifications";
import type { LocaleCode } from "#libs/preferences";
import { NotificationMessages, type NotificationWords } from "#modules/notifications/messages.ts";

type Catalog = typeof NotificationMessages.en;

/** A key of the notification catalog. */
export type NotificationKey = keyof Catalog;

/**
 * The bridge between a notification and its words: filed as a key and parameters, which no language owns, and
 * rendered where the reader is known.
 */
export class NotificationText {
  /**
   * The message to file for `key`, its parameters checked against the catalog.
   */
  static create<Key extends NotificationKey>(key: Key, ...params: Parameters<Catalog[Key]>): NotificationMessage {
    return { key, params: params[0] ?? {} };
  }

  /**
   * What `notification` says in `locale`. A row filed before messages, or with a key a later version dropped, reads
   * as it was stored.
   */
  static render(notification: NotificationPayload, locale: LocaleCode): NotificationWords {
    const { message } = notification;

    if (!message || !NotificationText.isKey(message.key)) {
      return notification.description
        ? { title: notification.title, description: notification.description }
        : { title: notification.title };
    }

    // The parameters come back from the database: they are what `create` checked when the row was filed.
    const render = NotificationMessages[locale][message.key] as (
      params: NotificationMessage["params"],
    ) => NotificationWords;

    return render(message.params);
  }

  private static isKey(key: string): key is NotificationKey {
    return Object.hasOwn(NotificationMessages.en, key);
  }
}
