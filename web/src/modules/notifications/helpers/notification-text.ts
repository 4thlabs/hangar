import type { NotificationMessage } from "#libs/api";
import { commonLabels } from "#modules/common/helpers/common-labels.ts";
import { composeLabel, composeOutcome } from "#modules/common/helpers/compose-actions.ts";
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
  composeSucceeded: ({ params: { project, action } }) => {
    // An operation this page does not know, from a server newer than it, reads as a plain notification.
    if (!Object.hasOwn(commonLabels.operations, action.operation)) {
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
  composeFailed: ({ params: { project, action } }) => {
    const label = Object.hasOwn(commonLabels.operations, action.operation)
      ? composeLabel(action)
      : m.notifications_compose_failed_plain_label();

    return {
      title: m.notifications_compose_failed_title({ label }),
      description: m.notifications_compose_failed_description({ project }),
    };
  },
  updatesAvailable: ({ params: { count } }) => ({
    title: m.notifications_updates_available_title(),
    description: m.notifications_updates_available_description({ count }),
  }),
  autoUpdate: ({ params }) => ({
    title: m.notifications_auto_update_title(),
    description: autoUpdateDescription(params),
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

/** What an update of the apps says it did: how many it updated, then the apps it failed for and those it skipped. */
function autoUpdateDescription({
  updated,
  failed,
  skipped,
}: Extract<NotificationMessage, { key: "autoUpdate" }>["params"]): string {
  if (failed.length > 0 && skipped.length > 0) {
    return m.notifications_auto_update_failed_skipped_description({
      updated,
      failed: names.format(failed),
      skipped: names.format(skipped),
    });
  }

  if (failed.length > 0) {
    return m.notifications_auto_update_failed_description({ updated, failed: names.format(failed) });
  }

  if (skipped.length > 0) {
    return m.notifications_auto_update_skipped_description({ updated, skipped: names.format(skipped) });
  }

  return m.notifications_auto_update_description({ updated });
}

/** What `message` says. */
export function describeNotification(message: NotificationMessage): NotificationWords {
  // A key this page does not know reads as a plain notification.
  if (!Object.hasOwn(wordsByKey, message.key)) {
    return { title: m.notifications_unknown_title() };
  }

  const words = wordsByKey[message.key] as (message: NotificationMessage) => NotificationWords;

  return words(message);
}
