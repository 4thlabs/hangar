import type { NotificationMessage } from "#libs/api";
import { composeActionOfNotification, composeLabel, composeOutcome } from "#modules/apps/compose-actions.ts";

/** What a notification says once worded. */
export type NotificationWords = { title: string; description?: string };

/** A key of the server's notifications, as `storeInstalled`. */
type NotificationKey = NotificationMessage["key"];

/** The words of each key, from the message, which carries its params. */
type Words = { [Key in NotificationKey]: (message: Extract<NotificationMessage, { key: Key }>) => NotificationWords };

/**
 * What the page says of a notification. The server files it as a key and its params, in no language: this is the one
 * place that words each key, typed by the keys of the contract, so that a key without words is a type error, and that a
 * catalog will word in another language. A key this page does not know, from a server newer than it, reads as a plain
 * notification.
 */
export class NotificationText {
  /** What a notification of a key this page does not know says. */
  static readonly Unknown: NotificationWords = { title: "Notification" };

  private static readonly Words: Words = {
    storeInstalled: () => ({ title: "Store: installation finished", description: "The store was installed." }),
    storeUpdated: () => ({ title: "Store: update finished", description: "The store was updated." }),
    storeInstallFailed: () => ({
      title: "Store: installation failed",
      description: "The installation of the store failed. See the server's log.",
    }),
    storeUpdateFailed: () => ({
      title: "Store: update failed",
      description: "The update of the store failed. See the server's log.",
    }),
    composeSucceeded: ({ params: { project, operation, flags } }) => {
      const action = composeActionOfNotification(operation, flags);

      if (action === null) {
        return { title: "Docker Compose finished", description: `The command succeeded for ${project}.` };
      }

      return {
        title: `${composeLabel(action)} finished`,
        description: composeOutcome(action, project),
      };
    },
    composeFailed: ({ params: { project, operation, flags } }) => {
      const action = composeActionOfNotification(operation, flags);
      const label = action === null ? "Docker Compose" : composeLabel(action);

      return {
        title: `${label} failed`,
        description: `The Docker Compose command failed for ${project}. See the server's log.`,
      };
    },
    updatesAvailable: ({ params: { count } }) => ({
      title: "Updates available",
      description: `${count} ${count === 1 ? "app has" : "apps have"} a newer image in the registry.`,
    }),
    autoUpdate: ({ params: { updated, failed } }) => ({
      title: "Automatic update",
      description: `${updated} ${updated === 1 ? "app was" : "apps were"} updated.${failed ? ` Failed for: ${failed}.` : ""}`,
    }),
  };

  /** What `message` says. */
  static describe(message: NotificationMessage): NotificationWords {
    if (!Object.hasOwn(NotificationText.Words, message.key)) {
      return NotificationText.Unknown;
    }

    const words = NotificationText.Words[message.key] as (message: NotificationMessage) => NotificationWords;

    return words(message);
  }
}
