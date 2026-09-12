"use server";

import { StoreActionResult } from "#app/actions/store/store-action-result.ts";
import { requireSession } from "#libs/auth";
import { logger } from "#libs/logs";
import { hangar } from "#libs/hangar/server";

export const manageStore = async (): Promise<StoreActionResult> => {
  await requireSession();

  const wasInstalled = await hangar.store.isInstalled();
  const operation = wasInstalled ? "mise à jour" : "installation";

  try {
    await hangar.store.update(true);
    await hangar.store.refresh();

    return StoreActionResult.success(wasInstalled ? "Le store a été mis à jour." : "Le store a été installé.");
  } catch (error) {
    logger.error({ error, operation }, "Store management failed");

    return StoreActionResult.failure(
      `La ${operation} du store a échoué. Consultez les logs du serveur.`,
      await hangar.store.isInstalled(),
    );
  }
};
