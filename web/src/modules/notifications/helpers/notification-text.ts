import type { NotificationMessage } from "#libs/api";
import { composeActionOfNotification, composeLabel, composeOutcome } from "#modules/common/helpers/compose-actions.ts";
import { describeErrorDetail } from "#modules/common/helpers/error-message.ts";
import { m } from "#paraglide/messages.js";

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

/** A list of names, as `web and db`. */
const names = new Intl.ListFormat("en", { type: "conjunction" });

/** The words of each key. */
const wordsByKey: Words = {
  storeInstalled: () => ({
    title: m.notifications_store_installed_title(),
    description: m.notifications_store_installed_description(),
  }),
  storeUpdated: () => ({
    title: m.notifications_store_updated_title(),
    description: m.notifications_store_updated_description(),
  }),
  storeInstallFailed: () => ({
    title: m.notifications_store_install_failed_title(),
    description: m.notifications_store_install_failed_description(),
  }),
  storeUpdateFailed: () => ({
    title: m.notifications_store_update_failed_title(),
    description: m.notifications_store_update_failed_description(),
  }),
  composeSucceeded: ({ params: { project, operation, flags } }) => {
    const action = composeActionOfNotification(operation, flags);

    if (action === null) {
      return {
        title: m.notifications_compose_succeeded_plain_title(),
        description: m.notifications_compose_succeeded_plain_description({ project }),
      };
    }

    return {
      title: m.notifications_compose_succeeded_title({ label: composeLabel(action) }),
      description: composeOutcome(action, project),
    };
  },
  composeFailed: ({ params: { project, operation, flags } }) => {
    const action = composeActionOfNotification(operation, flags);
    const label = action === null ? m.notifications_compose_failed_plain_label() : composeLabel(action);

    return {
      title: m.notifications_compose_failed_title({ label }),
      description: m.notifications_compose_failed_description({ project }),
    };
  },
  updatesAvailable: ({ params: { count } }) => ({
    title: m.notifications_updates_available_title(),
    description: m.notifications_updates_available_description({ count }),
  }),
  autoUpdate: ({ params: { updated, failed } }) => ({
    title: m.notifications_auto_update_title(),
    description: failed
      ? m.notifications_auto_update_failed_description({ updated, failed })
      : m.notifications_auto_update_description({ updated }),
  }),
  backupFailed: ({ params: { app, error } }) => ({
    title: m.notifications_backup_failed_title(),
    description: m.notifications_backup_failed_description({ app, error: describeErrorDetail(error) }),
  }),
  backupRestartFailed: ({ params: { app, services } }) => ({
    title: m.notifications_backup_restart_failed_title(),
    description: m.notifications_backup_restart_failed_description({ app, services: names.format(services) }),
  }),
};

/** What `message` says. */
export function describeNotification(message: NotificationMessage): NotificationWords {
  // A key this page does not know reads as a plain notification.
  if (!Object.hasOwn(wordsByKey, message.key)) {
    return { title: m.notifications_unknown_title() };
  }

  const words = wordsByKey[message.key] as (message: NotificationMessage) => NotificationWords;

  return words(message);
}
