"use server";

import { SERVER_LOG_HINT } from "#app/actions/action-result.ts";
import { StoreActionResult } from "#app/actions/store/store-action-result.ts";
import { requireSession } from "#libs/auth";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";

export const uninstallApp = async (appId: string): Promise<StoreActionResult> => {
  await requireSession();

  const app = hangar.store.app(appId);

  if (!app) {
    logger.warn("App uninstallation rejected: unknown app", { appId });

    return StoreActionResult.failure("Cette application n’existe pas dans le store.");
  }

  if (!app.installed) {
    return StoreActionResult.success(`${app.name} n’est pas installée.`, false);
  }

  try {
    // Down before unlinking: once the symlink is gone the compose file is unreachable and any
    // running container becomes an orphan Hangar can no longer manage.
    await hangar.store.compose(app.id, ["down"]);
    await hangar.store.unlink(app.id);
    await hangar.store.refresh();

    const installed = hangar.store.app(app.id)?.installed ?? false;

    return installed
      ? StoreActionResult.failure(`La désinstallation de ${app.name} n’a pas pu être confirmée.`, true)
      : StoreActionResult.success(`${app.name} a été désinstallée.`, false);
  } catch (error) {
    logger.error("App uninstallation failed", { error, appId: app.id });

    return StoreActionResult.failure(`La désinstallation de ${app.name} a échoué. ${SERVER_LOG_HINT}`, true);
  }
};
