"use server";

import { ActionResult, SERVER_LOG_HINT } from "#app/actions/action-result.ts";
import { requireSession } from "#libs/auth";
import { HangarError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";

/** Saves hangar.yml. The config validates it first: an invalid file is reported, never written. */
export const saveConfig = async (source: string): Promise<ActionResult> => {
  await requireSession();

  try {
    await hangar.store.config.write(source);

    return ActionResult.success("La configuration a été enregistrée.");
  } catch (error) {
    // A validation failure is the user's to fix: show it, the issues name the faulty paths.
    if (error instanceof HangarError) return ActionResult.failure(error.message);

    logger.error("Hangar config save failed", { error });

    return ActionResult.failure(`L’enregistrement de la configuration a échoué. ${SERVER_LOG_HINT}`);
  }
};
