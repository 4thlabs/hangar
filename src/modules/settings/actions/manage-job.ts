"use server";

import { Sidequest } from "sidequest";
import { sessions } from "#libs/auth/server";
import { ServerTranslation } from "#libs/i18n/server";
import { logger } from "#libs/logs";
import { ActionFailure } from "#modules/common/actions/action-failure.ts";
import { ActionResult } from "#modules/common/actions/action-result.ts";
import { SettingsMessages } from "#modules/settings/messages.ts";

/** Sidequest's `force`: without it, a completed or failed job (the ones the Jobs card offers) would not run again. */
const FORCE_RERUN = true;

/** Runs a job again from the Jobs settings card. */
export const runJob = async (id: number): Promise<ActionResult> => {
  await sessions.require();

  const { t } = ServerTranslation.get(SettingsMessages);

  try {
    await Sidequest.job.run(id, FORCE_RERUN);

    return ActionResult.success(t("jobs.rerunMessage"));
  } catch (error) {
    logger.error("Job rerun failed", { error, id });

    return ActionResult.failure(ActionFailure.withLogHint(t("jobs.rerunError")));
  }
};

/** Cancels a waiting or running job from the Jobs settings card. */
export const cancelJob = async (id: number): Promise<ActionResult> => {
  await sessions.require();

  const { t } = ServerTranslation.get(SettingsMessages);

  try {
    await Sidequest.job.cancel(id);

    return ActionResult.success(t("jobs.cancelMessage"));
  } catch (error) {
    logger.error("Job cancel failed", { error, id });

    return ActionResult.failure(ActionFailure.withLogHint(t("jobs.cancelError")));
  }
};
