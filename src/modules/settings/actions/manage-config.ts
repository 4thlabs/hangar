"use server";

import { sessions } from "#libs/auth/server";
import { HangarError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { ServerTranslation } from "#libs/i18n/server";
import { backupJobs } from "#libs/jobs/server";
import { logger } from "#libs/logs";
import { ActionFailure } from "#modules/common/actions/action-failure.ts";
import { ActionResult } from "#modules/common/actions/action-result.ts";
import { SettingsMessages } from "#modules/settings/messages.ts";

/** Saves hangar.yml. The config validates it first: an invalid file is reported, never written. */
export const saveConfig = async (source: string): Promise<ActionResult> => {
  await sessions.require();

  const { t } = ServerTranslation.get(SettingsMessages);

  try {
    await hangar.store.saveConfig(source);
  } catch (error) {
    // A validation failure is the user's to fix: show it, the issues name the faulty paths.
    if (error instanceof HangarError) {
      return ActionResult.failure(error.message);
    }

    logger.error("Hangar config save failed", { error });

    return ActionResult.failure(ActionFailure.withLogHint(t("config.saveFailed")));
  }

  // Apart: the file is saved by now, and only its schedules failed to follow.
  try {
    await backupJobs.sync(hangar.store.config.backups());
  } catch (error) {
    logger.error("Backup schedules update failed", { error });

    return ActionResult.failure(ActionFailure.withLogHint(t("config.schedulesFailed")));
  }

  return ActionResult.success(t("config.savedMessage"));
};
