"use server";

import { sessions } from "#libs/auth/server";
import { backups } from "#libs/backups/server";
import { NotFoundError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { backupJobs } from "#libs/jobs/server";
import { logger } from "#libs/logs";
import { ActionResult, SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";

/** Backs up an app now, from its page: the same run as a scheduled one, so it shows in the Jobs settings. */
export const backupApp = async (project: string): Promise<ActionResult> => {
  await sessions.require();

  if (!hangar.store.config.backup(project)) {
    return ActionResult.failure(`hangar.yml ne déclare aucune sauvegarde pour ${project}.`);
  }

  try {
    const request = await backupJobs.request(project);

    if (request === "already-running") {
      return ActionResult.failure(`Une sauvegarde de ${project} est déjà en cours.`);
    }

    return ActionResult.success(`La sauvegarde de ${project} a été lancée.`);
  } catch (error) {
    logger.error("Backup request failed", { error, project });

    return ActionResult.failure(`Le lancement de la sauvegarde a échoué. ${SERVER_LOG_HINT}`);
  }
};

/** Removes one archive of an app, from its page. */
export const deleteBackup = async (project: string, archive: string): Promise<ActionResult> => {
  await sessions.require();

  try {
    await backups.remove(project, archive);

    return ActionResult.success("L’archive a été supprimée.");
  } catch (error) {
    if (error instanceof NotFoundError) {
      return ActionResult.failure("Cette archive n’existe plus.");
    }

    logger.error("Backup removal failed", { error, project, archive });

    return ActionResult.failure(`La suppression de l’archive a échoué. ${SERVER_LOG_HINT}`);
  }
};
