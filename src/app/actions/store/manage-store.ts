"use server";

import { StoreActionResult } from "#app/actions/store/store-action-result.ts";
import { SERVER_LOG_HINT } from "#app/actions/action-result.ts";
import { requireSession } from "#libs/auth";
import { logger } from "#libs/logs";
import { hangar } from "#libs/hangar/server";
import { notifications } from "#libs/notifications/server";

export const manageStore = async (): Promise<StoreActionResult> => {
  const { user } = await requireSession();

  const wasInstalled = await hangar.store.isInstalled();
  const operation = wasInstalled ? "mise à jour" : "installation";

  // Detached: a clone or a pull is as long as the network makes it, and holding the request open
  // for it only risks a timeout. The outcome comes back as a notification.
  void hangar.store
    .install()
    .then(() => hangar.store.refresh())
    .then(() =>
      notifications.notify({
        userId: user.id,
        level: "success",
        title: `Store : ${operation} terminée`,
        description: wasInstalled ? "Le store a été mis à jour." : "Le store a été installé.",
        href: "/settings",
      }),
    )
    .catch((error: unknown) => {
      logger.error("Store management failed", { error, operation });

      return notifications.notify({
        userId: user.id,
        level: "error",
        title: `Store : ${operation} échouée`,
        description: `La ${operation} du store a échoué. ${SERVER_LOG_HINT}`,
        href: "/settings",
      });
    });

  // `wasInstalled`, not the state to come: nothing has been synchronised yet, and the page
  // refreshes itself when the notification lands.
  return StoreActionResult.success(`La ${operation} du store a été lancée.`, wasInstalled);
};
