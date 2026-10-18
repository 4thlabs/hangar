"use server";

import { sessions } from "#libs/auth/server";
import { SelfUpdateUnavailableError } from "#libs/docker";
import { selfUpdate } from "#libs/docker/server";
import { logger } from "#libs/logs";
import { ActionResult, SERVER_LOG_HINT, type ReadResult } from "#modules/common/actions/action-result.ts";

/** The image Hangar would pull to update itself, or why it cannot update itself where it runs. */
export const readHangarImage = async (): Promise<ReadResult<string>> => {
  await sessions.require();

  try {
    return { success: true, value: (await selfUpdate.target()).image };
  } catch (error) {
    if (error instanceof SelfUpdateUnavailableError) {
      return { success: false, message: error.message };
    }

    logger.error("Self-update target read failed", { error });

    return { success: false, message: `Docker n’a pas pu décrire le conteneur de Hangar. ${SERVER_LOG_HINT}` };
  }
};

/** Pulls Hangar's image and recreates its container, through a relay that outlives this process. */
export const updateHangar = async (): Promise<ActionResult> => {
  await sessions.require();

  try {
    const { image } = await selfUpdate.start();

    logger.info(`Self-update started from ${image}`);

    // Nothing more comes back: if the registry has a newer image, this server stops in a moment.
    return ActionResult.success(
      "Mise à jour lancée. Si une nouvelle image existe, Hangar redémarre : rechargez la page dans un instant.",
    );
  } catch (error) {
    if (error instanceof SelfUpdateUnavailableError) {
      return ActionResult.failure(error.message);
    }

    logger.error("Self-update failed to start", { error });

    return ActionResult.failure(`La mise à jour de Hangar n’a pas pu démarrer. ${SERVER_LOG_HINT}`);
  }
};
