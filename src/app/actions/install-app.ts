"use server";

import { StoreActionResult } from "#app/actions/store-action-result.ts";
import { requireSession } from "#libs/auth";
import { hangar } from "#libs/hangar";
import { logger } from "#libs/logs";

export const installApp = async (appId: string): Promise<StoreActionResult> => {
  await requireSession();

  const app = [...hangar.store.apps].find(candidate => candidate.id === appId);

  if (!app) {
    logger.warn({ appId }, "App installation rejected: unknown app");

    return StoreActionResult.failure("Cette application n’existe pas dans le store.");
  }

  if (app.installed) {
    return StoreActionResult.success(`${app.name} est déjà installée.`);
  }

  try {
    await hangar.store.link(app.id);
    await hangar.store.refresh();

    const installed = [...hangar.store.apps].some(candidate => candidate.id === app.id && candidate.installed);

    return installed
      ? StoreActionResult.success(`${app.name} a été installée.`)
      : StoreActionResult.failure(`L’installation de ${app.name} n’a pas pu être confirmée.`);
  } catch (error) {
    logger.error({ error, appId: app.id }, "App installation failed");

    return StoreActionResult.failure(`L’installation de ${app.name} a échoué. Consultez les logs du serveur.`);
  }
};
