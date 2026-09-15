"use server";

import { ActionResult, SERVER_LOG_HINT } from "#app/actions/action-result.ts";
import { type AppOperation } from "#app/actions/apps/app-operation.ts";
import { appOperationArguments, refuseAppOperation } from "#app/actions/apps/app-operations.ts";
import { requireSession } from "#libs/auth";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";

export async function manageApp(project: string, operation: AppOperation): Promise<ActionResult> {
  await requireSession();

  const refusal = refuseAppOperation(project, operation);
  if (refusal) {
    logger.warn("Docker Compose command rejected", { project, operation, reason: refusal.reason });
    return ActionResult.failure(refusal.message);
  }

  try {
    await hangar.store.compose(project, [...appOperationArguments[operation]]);
    return ActionResult.success(
      {
        up: `${project} a été démarrée ou mise à jour.`,
        down: `${project} a été arrêtée et supprimée.`,
        recreate: `${project} a été recréée.`,
      }[operation],
    );
  } catch (error) {
    logger.error("Docker Compose app command failed", { error, project, operation });
    return ActionResult.failure(`La commande Docker Compose a échoué. ${SERVER_LOG_HINT}`);
  }
}
