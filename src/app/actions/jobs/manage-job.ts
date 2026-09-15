"use server";

import { ActionResult, SERVER_LOG_HINT } from "#app/actions/action-result.ts";
import { requireSession } from "#libs/auth";
import { Sidequest } from "sidequest";
import { logger } from "#libs/logs";

export const runJob = async (id: number): Promise<ActionResult> => {
  await requireSession();

  try {
    await Sidequest.job.run(id, true);
    return ActionResult.success("Le job a été relancé.");
  } catch (error) {
    logger.error("Job rerun failed", { error, id });
    return ActionResult.failure(`La relance du job a échoué. ${SERVER_LOG_HINT}`);
  }
};

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
