"use server";

import { SERVER_LOG_HINT } from "#app/actions/action-result.ts";
import { StoreActionResult } from "#app/actions/store/store-action-result.ts";
import { requireSession } from "#libs/auth";
import { logger } from "#libs/logs";
import { hangar } from "#libs/hangar/server";

export const manageStore = async (): Promise<StoreActionResult> => {
  await requireSession();

  const wasInstalled = await hangar.store.isInstalled();
  const operation = wasInstalled ? "mise à jour" : "installation";

  try {
    await hangar.store.install();
    await hangar.store.refresh();

    return StoreActionResult.success(wasInstalled ? "Le store a été mis à jour." : "Le store a été installé.");
  } catch (error) {
    logger.error("Store management failed", { error, operation });

    // Do not call isInstalled() here: if the filesystem is why update() threw,
    // this would reject inside the catch and escape the handler entirely.
    return StoreActionResult.failure(`La ${operation} du store a échoué. ${SERVER_LOG_HINT}`, wasInstalled);
  }
};
