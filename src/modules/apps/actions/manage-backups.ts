"use server";

import { sessions } from "#libs/auth/server";
import { backups } from "#libs/backups/server";
import { NotFoundError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { ServerTranslation } from "#libs/i18n/server";
import { backupJobs } from "#libs/jobs/server";
import { logger } from "#libs/logs";
import { AppsMessages } from "#modules/apps/messages.ts";
import { ActionFailure } from "#modules/common/actions/action-failure.ts";
import { ActionResult } from "#modules/common/actions/action-result.ts";

/** Backs up an app now, from its page: the same run as a scheduled one, so it shows in the Jobs settings. */
export const backupApp = async (project: string): Promise<ActionResult> => {
  await sessions.require();

  const { t } = ServerTranslation.get(AppsMessages);

  if (!hangar.store.config.backup(project)) {
    return ActionResult.failure(t("backups.notDeclared", { project }));
  }

  try {
    const request = await backupJobs.request(project);

    if (request === "already-running") {
      return ActionResult.failure(t("backups.alreadyRunning", { project }));
    }

    return ActionResult.success(t("backups.launched", { project }));
  } catch (error) {
    logger.error("Backup request failed", { error, project });

    return ActionResult.failure(ActionFailure.withLogHint(t("backups.launchFailed")));
  }
};

/** Removes one archive of an app, from its page. */
export const deleteBackup = async (project: string, archive: string): Promise<ActionResult> => {
  await sessions.require();

  const { t } = ServerTranslation.get(AppsMessages);

  try {
    await backups.remove(project, archive);

    return ActionResult.success(t("backups.archiveDeleted"));
  } catch (error) {
    if (error instanceof NotFoundError) {
      return ActionResult.failure(t("backups.archiveGone"));
    }

    logger.error("Backup removal failed", { error, project, archive });

    return ActionResult.failure(ActionFailure.withLogHint(t("backups.archiveDeleteFailed")));
  }
};
