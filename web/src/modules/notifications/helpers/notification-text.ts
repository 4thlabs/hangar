import type { NotificationMessage } from "#libs/api";
import { composeActionOfNotification, composeLabel, composeOutcome } from "#modules/common/helpers/compose-actions.ts";
import { notificationsMessages } from "#modules/notifications/messages.ts";

const words = notificationsMessages;

/** What a notification says once worded. */
export type NotificationWords = { title: string; description?: string };

/** A key of the server's notifications, as `storeInstalled`. */
type NotificationKey = NotificationMessage["key"];

/** The words of each key, from the message, which carries its params. */
type Words = { [Key in NotificationKey]: (message: Extract<NotificationMessage, { key: Key }>) => NotificationWords };

// What the page says of a notification. The server files it as a key and its params, in no language: this is the one
// place that words each key, typed by the keys of the contract, so that a key without words is a type error, and that a
// catalog will word in another language. A key this page does not know, from a server newer than it, reads as a plain
// notification.

/** What a notification of a key this page does not know says. */
export const unknownNotification: NotificationWords = { title: words.unknown };

/** The words of each key. */
const wordsByKey: Words = {
  storeInstalled: () => words.storeInstalled,
  storeUpdated: () => words.storeUpdated,
  storeInstallFailed: () => words.storeInstallFailed,
  storeUpdateFailed: () => words.storeUpdateFailed,
  composeSucceeded: ({ params: { project, operation, flags } }) => {
    const action = composeActionOfNotification(operation, flags);

    if (action === null) {
      return {
        title: words.composeSucceeded.plainTitle,
        description: words.composeSucceeded.plainDescription({ project }),
      };
    }

    return {
      title: words.composeSucceeded.title({ label: composeLabel(action) }),
      description: composeOutcome(action, project),
    };
  },
  composeFailed: ({ params: { project, operation, flags } }) => {
    const action = composeActionOfNotification(operation, flags);
    const label = action === null ? words.composeFailed.plainLabel : composeLabel(action);

    return { title: words.composeFailed.title({ label }), description: words.composeFailed.description({ project }) };
  },
  updatesAvailable: ({ params: { count } }) => ({
    title: words.updatesAvailable.title,
    description: words.updatesAvailable.description({ count }),
  }),
  autoUpdate: ({ params: { updated, failed } }) => ({
    title: words.autoUpdate.title,
    description: words.autoUpdate.description({ updated, failed }),
  }),
};

/** What `message` says. */
export function describeNotification(message: NotificationMessage): NotificationWords {
  if (!Object.hasOwn(wordsByKey, message.key)) {
    return unknownNotification;
  }

  const words = wordsByKey[message.key] as (message: NotificationMessage) => NotificationWords;

  return words(message);
}
