"use server";

import { StoreActionResult } from "#app/components/settings/store-settings-card.tsx";
import { requireSession } from "#libs/auth";
import { logger } from "#libs/logs";
import { hangar } from "#libs/hangar";

export const manageStore = async (): Promise<StoreActionResult> => {
  await requireSession();

  const wasInstalled = await hangar.store.isInstalled();
  const operation = wasInstalled ? "mise à jour" : "installation";

  try {
    await hangar.store.update(true);
    await hangar.store.refresh();

    return {
      success: true,
      installed: true,
      message: wasInstalled ? "Le store a été mis à jour." : "Le store a été installé.",
    };
  } catch (error) {
    logger.error({ error, operation }, "Store management failed");

    return {
      success: false,
      installed: await hangar.store.isInstalled(),
      message: `La ${operation} du store a échoué. Consultez les logs du serveur.`,
    };
  }
};
