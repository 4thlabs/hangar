"use server";

import { sessions } from "#libs/auth/server";
import { HangarError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";
import { StoreActionResult } from "#modules/store/actions/store-action-result.ts";

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

export const installApp = async (appId: string): Promise<StoreActionResult> => {
  const app = await findApp(appId, "App installation rejected: unknown app");

  if (!app) {
    return StoreActionResult.failure(UNKNOWN_APP);
  }

  if (app.installed) {
    return StoreActionResult.success(`${app.name} est déjà installée.`);
  }

  try {
    await hangar.store.link(app.id);
    await hangar.store.refresh();
    // Only this app's files: the variables it needs must show up in settings without a store update.
    await hangar.store.env.ensure(app.id);

    const installed = hangar.store.app(app.id)?.installed ?? false;

    return installed
      ? StoreActionResult.success(`${app.name} a été installée.`)
      : StoreActionResult.failure(`L’installation de ${app.name} n’a pas pu être confirmée.`);
  } catch (error) {
    logger.error("App installation failed", { error, appId: app.id });

    return StoreActionResult.failure(`L’installation de ${app.name} a échoué. ${SERVER_LOG_HINT}`);
  }
};

export const uninstallApp = async (appId: string): Promise<StoreActionResult> => {
  const app = await findApp(appId, "App uninstallation rejected: unknown app");

  if (!app) {
    return StoreActionResult.failure(UNKNOWN_APP);
  }

  if (!app.installed) {
    return StoreActionResult.success(`${app.name} n’est pas installée.`, false);
  }

  try {
    // Down before unlinking: once the symlink is gone the compose files are unreachable and whatever
    // runs becomes an orphan Hangar can no longer manage.
    if (app.runsInSwarm) {
      await hangar.store.removeFromSwarm(app.id, { capture: true });
    } else {
      await hangar.store.compose(app.id, ["down"]);
    }

    await hangar.store.unlink(app.id);
    await hangar.store.refresh();

    const installed = hangar.store.app(app.id)?.installed ?? false;

    return installed
      ? StoreActionResult.failure(`La désinstallation de ${app.name} n’a pas pu être confirmée.`, true)
      : StoreActionResult.success(`${app.name} a été désinstallée.`, false);
  } catch (error) {
    logger.error("App uninstallation failed", { error, appId: app.id });

    return StoreActionResult.failure(`La désinstallation de ${app.name} a échoué. ${SERVER_LOG_HINT}`, true);
  }
};

/** Moves an app to the swarm; see `HangarStore.deployToSwarm`. */
export const deployToSwarm = async (appId: string): Promise<StoreActionResult> => {
  const app = await findApp(appId, "Swarm deployment rejected: unknown app");

  if (!app) {
    return StoreActionResult.failure(UNKNOWN_APP);
  }

  if (!app.swarmReady) {
    return StoreActionResult.failure(
      `${app.name} n’a pas de compose.swarm.yml : elle ne peut pas tourner dans le swarm.`,
    );
  }

  try {
    await hangar.store.deployToSwarm(app.id, { capture: true });

    return StoreActionResult.success(`${app.name} est déployée sur le swarm.`);
  } catch (error) {
    // Docker's own complaint (not a manager, a bad file) says what to fix.
    if (error instanceof HangarError) {
      return StoreActionResult.failure(`Le déploiement de ${app.name} a échoué : ${error.message}`, true);
    }

    logger.error("Swarm deployment failed", { error, appId: app.id });

    return StoreActionResult.failure(`Le déploiement de ${app.name} a échoué. ${SERVER_LOG_HINT}`, true);
  }
};
