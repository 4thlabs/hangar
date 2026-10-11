"use server";

import { sessions } from "#libs/auth/server";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { ActionFailure } from "#modules/common/actions/action-failure.ts";
import { ActionResult, type ReadResult } from "#modules/common/actions/action-result.ts";

const UNKNOWN_APP = "Cette application n’existe pas dans le store.";

/** The store app behind `appId`, for a signed-in user; logs `rejected` when there is none. */
async function findApp(appId: string, rejected: string) {
  await sessions.require();

  const app = hangar.store.app(appId);

  if (!app) {
    logger.warn(rejected, { appId });
  }

  return app;
}

/**
 * Seeds the app's variables in `.env.global`, then names those still empty, for the confirmation before
 * "Démarrer" or "Déployer sur le swarm": seeding writes empty values, and an app would start with them.
 */
export const unfilledVariables = async (appId: string): Promise<ReadResult<string[]>> => {
  const app = await findApp(appId, "Variable check rejected: unknown app");

  if (!app) {
    return { success: false, message: UNKNOWN_APP };
  }

  try {
    return { success: true, value: await hangar.store.env.unfilled(app.id) };
  } catch (error) {
    const { message } = ActionFailure.from(
      error,
      "Variable check failed",
      `La lecture des variables de ${app.name} a échoué.`,
      { appId: app.id },
    );

    return { success: false, message };
  }
};

/** Starts an app with compose, `docker compose up -d`; its swarm stack, if any, is left alone. */
export const startApp = async (appId: string): Promise<ActionResult> => {
  const app = await findApp(appId, "App start rejected: unknown app");

  if (!app) {
    return ActionResult.failure(UNKNOWN_APP);
  }

  try {
    await hangar.store.env.ensure(app.id);
    await hangar.store.composeApp(app.id, ["up", "-d"], { capture: true });

    return ActionResult.success(`${app.name} a été démarrée.`);
  } catch (error) {
    // Docker's own complaint (a bad file, a port taken) is shown as is: it says what to fix.
    return ActionFailure.from(error, "App start failed", `Le démarrage de ${app.name} a échoué.`, { appId: app.id });
  }
};

/** Deploys an app's stack to the swarm, its compose project left alone; see `HangarStore.deployToSwarm`. */
export const deployToSwarm = async (appId: string): Promise<ActionResult> => {
  const app = await findApp(appId, "Swarm deployment rejected: unknown app");

  if (!app) {
    return ActionResult.failure(UNKNOWN_APP);
  }

  if (!app.swarmReady) {
    return ActionResult.failure(`${app.name} n’a pas de compose.swarm.yml : elle ne peut pas tourner dans le swarm.`);
  }

  try {
    await hangar.store.deployToSwarm(app.id, { capture: true });

    return ActionResult.success(`${app.name} est déployée sur le swarm.`);
  } catch (error) {
    // Docker's own complaint (not a manager, a bad file) is shown as is: it says what to fix.
    return ActionFailure.from(error, "Swarm deployment failed", `Le déploiement de ${app.name} a échoué.`, {
      appId: app.id,
    });
  }
};
