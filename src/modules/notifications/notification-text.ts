import type { NotificationMessage } from "#libs/db";
import { Translation } from "#libs/i18n";
import type { NotificationKey, NotificationPayload } from "#libs/notifications";
import type { LocaleCode } from "#libs/preferences";
import { NotificationsMenuMessages } from "#modules/notifications/menu-messages.ts";
import { NotificationMessages, type NotificationWords } from "#modules/notifications/messages.ts";

/** How a stored message is rendered: the words of its key, from parameters the database hands back untyped. */
type StoredRender = (params: NotificationMessage["params"]) => NotificationWords;

/**
 * What a notification says, in the reader's language. Filed as a key and parameters (`Notifications.message`), which
 * no language owns, and rendered here, where the reader is known.
 */
export class NotificationText {
  /**
   * What `notification` says in `locale`. A row filed before messages reads as it was stored. One whose key a later
   * version dropped, or whose parameters no longer fit its words, reads as a plain notification rather than taking
   * the bell down with it.
   */
  static render(notification: NotificationPayload, locale: LocaleCode): NotificationWords {
    const { message } = notification;

    if (!message) {
      return NotificationText.stored(notification);
    }

    if (!NotificationText.isKey(message.key)) {
      return NotificationText.unknown(locale);
    }

    try {
      return (NotificationMessages[locale][message.key] as StoredRender)(message.params);
    } catch (error) {
      console.error("A notification's parameters no longer fit its words", { key: message.key, error });

      return NotificationText.unknown(locale);
    }
  }

  /** The words of a row filed before messages, as they were stored. */
  private static stored({ title, description }: NotificationPayload): NotificationWords {
    return description ? { title, description } : { title };
  }

  /** What a notification says when its words are gone. */
  private static unknown(locale: LocaleCode): NotificationWords {
    return { title: Translation.create(NotificationsMenuMessages, locale)("unknown") };
  }

  private static isKey(key: string): key is NotificationKey {
    return Object.hasOwn(NotificationMessages.en, key);
  }
}
