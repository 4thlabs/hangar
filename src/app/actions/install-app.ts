"use server";

import { requireSession } from "#libs/auth";
import { hangar } from "#libs/hangar";
import { logger } from "#libs/logs";

export type InstallAppResult = {
  success: boolean;
  installed: boolean;
  message: string;
};

export const installApp = async (appId: string): Promise<InstallAppResult> => {
  await requireSession();

  const app = [...hangar.store.apps].find(candidate => candidate.id === appId);

  if (!app) {
    logger.warn({ appId }, "App installation rejected: unknown app");

    return {
      success: false,
      installed: false,
      message: "Cette application n’existe pas dans le store.",
    };
  }

  if (app.installed) {
    return {
      success: true,
      installed: true,
      message: `${app.name} est déjà installée.`,
    };
  }

  try {
    await hangar.store.link(app.id);
    await hangar.store.refresh();

    const installed = [...hangar.store.apps].some(candidate => candidate.id === app.id && candidate.installed);

    return {
      success: installed,
      installed,
      message: installed ? `${app.name} a été installée.` : `L’installation de ${app.name} n’a pas pu être confirmée.`,
    };
  } catch (error) {
    logger.error({ error, appId: app.id }, "App installation failed");

    return {
      success: false,
      installed: false,
      message: `L’installation de ${app.name} a échoué. Consultez les logs du serveur.`,
    };
  }
};
