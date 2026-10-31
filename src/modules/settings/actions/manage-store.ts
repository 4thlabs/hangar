"use server";

import { sessions } from "#libs/auth/server";
import { hangar } from "#libs/hangar/server";
import { ServerTranslation } from "#libs/i18n/server";
import { backupJobs } from "#libs/jobs/server";
import { logger } from "#libs/logs";
import { notifications } from "#libs/notifications/server";
import { NotificationText } from "#modules/notifications/notification-text.ts";
import { SettingsMessages } from "#modules/settings/messages.ts";
import { StoreActionResult } from "#modules/store/actions/store-action-result.ts";

export const manageStore = async (): Promise<StoreActionResult> => {
  const { user } = await sessions.require();

  const { t } = ServerTranslation.get(SettingsMessages);
  const wasInstalled = await hangar.store.isInstalled();
  const operation = wasInstalled ? "update" : "install";

  // Detached: a clone or a pull is as long as the network makes it, and holding the request open
  // for it only risks a timeout. The outcome comes back as a notification.
  void hangar.store
    .install()
    .then(() => hangar.store.refresh())
    // The pull may have brought a hangar.yml with other backups.
    .then(() => backupJobs.sync(hangar.store.config.backups()))
    .then(() =>
      notifications.notify({
        userId: user.id,
        level: "success",
        message: NotificationText.create(wasInstalled ? "storeUpdated" : "storeInstalled"),
        href: "/settings",
      }),
    )
    .catch((error: unknown) => {
      logger.error("Store management failed", { error, operation });

      return notifications.notify({
        userId: user.id,
        level: "error",
        message: NotificationText.create(wasInstalled ? "storeUpdateFailed" : "storeInstallFailed"),
        href: "/settings",
      });
    });

  // `wasInstalled`, not the state to come: nothing has been synchronised yet, and the page
  // refreshes itself when the notification lands.
  return StoreActionResult.success(t(wasInstalled ? "store.updateStarted" : "store.installStarted"), wasInstalled);
};
