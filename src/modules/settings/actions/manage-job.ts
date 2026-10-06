"use server";

import { ActionResult, SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";
import { requireSession } from "#libs/auth";
import { Sidequest } from "sidequest";
import { logger } from "#libs/logs";

/** Sidequest's `force`: without it, a completed or failed job (the ones the Jobs card offers) would not run again. */
const FORCE_RERUN = true;

/** Runs a job again from the Jobs settings card. */
export const runJob = async (id: number): Promise<ActionResult> => {
  await requireSession();

  try {
    await Sidequest.job.run(id, FORCE_RERUN);
    return ActionResult.success("Le job a été relancé.");
  } catch (error) {
    logger.error("Job rerun failed", { error, id });
    return ActionResult.failure(`La relance du job a échoué. ${SERVER_LOG_HINT}`);
  }
};

/** Cancels a waiting or running job from the Jobs settings card. */
export const cancelJob = async (id: number): Promise<ActionResult> => {
  await requireSession();

  try {
    await Sidequest.job.cancel(id);
    return ActionResult.success("Le job a été annulé.");
  } catch (error) {
    logger.error("Job cancel failed", { error, id });
    return ActionResult.failure(`L’annulation du job a échoué. ${SERVER_LOG_HINT}`);
  }
};
