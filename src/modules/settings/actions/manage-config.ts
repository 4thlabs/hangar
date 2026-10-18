"use server";

import { sessions } from "#libs/auth/server";
import { HangarError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { backupJobs } from "#libs/jobs/server";
import { logger } from "#libs/logs";
import { ActionResult, SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";

/** Saves hangar.yml. The config validates it first: an invalid file is reported, never written. */
export const saveConfig = async (source: string): Promise<ActionResult> => {
  await sessions.require();

  try {
    await hangar.store.saveConfig(source);
  } catch (error) {
    // A validation failure is the user's to fix: show it, the issues name the faulty paths.
    if (error instanceof HangarError) {
      return ActionResult.failure(error.message);
    }

    logger.error("Hangar config save failed", { error });

    return ActionResult.failure(`L’enregistrement de la configuration a échoué. ${SERVER_LOG_HINT}`);
  }

  // Apart: the file is saved by now, and only its schedules failed to follow.
  try {
    await backupJobs.sync(hangar.store.config.backups());
  } catch (error) {
    logger.error("Backup schedules update failed", { error });

    return ActionResult.failure(
      `La configuration a été enregistrée, mais les sauvegardes planifiées n’ont pas suivi. ${SERVER_LOG_HINT}`,
    );
  }

  return ActionResult.success("La configuration a été enregistrée.");
};
