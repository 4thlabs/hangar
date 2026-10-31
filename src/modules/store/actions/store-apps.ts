"use server";

import { sessions } from "#libs/auth/server";
import { hangar } from "#libs/hangar/server";
import { ServerTranslation } from "#libs/i18n/server";
import { logger } from "#libs/logs";
import { ActionFailure } from "#modules/common/actions/action-failure.ts";
import { StoreActionResult } from "#modules/store/actions/store-action-result.ts";
import { AppStacks } from "#modules/store/app-stacks.ts";
import { StoreMessages } from "#modules/store/messages.ts";

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
  const { t } = ServerTranslation.get(StoreMessages);

  if (!app) {
    return StoreActionResult.failure(t("actions.unknownApp"));
  }

  if (app.installed) {
    return StoreActionResult.success(t("actions.alreadyInstalled", { name: app.name }));
  }

  try {
    await hangar.store.link(app.id);
    await hangar.store.refresh();
    // Only this app's files: the variables it needs must show up in settings without a store update.
    await hangar.store.env.ensure(app.id);

    const installed = hangar.store.app(app.id)?.installed ?? false;

    return installed
      ? StoreActionResult.success(t("actions.installed", { name: app.name }))
      : StoreActionResult.failure(t("actions.installUnconfirmed", { name: app.name }));
  } catch (error) {
    logger.error("App installation failed", { error, appId: app.id });

    return StoreActionResult.failure(ActionFailure.withLogHint(t("actions.installFailed", { name: app.name })));
  }
};

export const uninstallApp = async (appId: string): Promise<StoreActionResult> => {
  const app = await findApp(appId, "App uninstallation rejected: unknown app");
  const { t } = ServerTranslation.get(StoreMessages);

  if (!app) {
    return StoreActionResult.failure(t("actions.unknownApp"));
  }

  if (!app.installed) {
    return StoreActionResult.success(t("actions.notInstalled", { name: app.name }), false);
  }

  try {
    // Down before unlinking: once the symlink is gone the compose files are unreachable and whatever
    // runs becomes an orphan Hangar can no longer manage.
    await hangar.store.compose(app.id, ["down"]);

    // An app may run in the swarm too: its stack goes with it, when this node can remove it.
    const stackLeftover = (await AppStacks.exists(app.id)) ? await hangar.store.removeStackIfPossible(app.id) : null;

    await hangar.store.unlink(app.id);
    await hangar.store.refresh();

    const installed = hangar.store.app(app.id)?.installed ?? false;

    const leftoverNote = stackLeftover ? ` ${t("actions.stackLeftover", { reason: stackLeftover })}` : "";

    return installed
      ? StoreActionResult.failure(t("actions.uninstallUnconfirmed", { name: app.name }), true)
      : StoreActionResult.success(`${t("actions.uninstalled", { name: app.name })}${leftoverNote}`, false);
  } catch (error) {
    logger.error("App uninstallation failed", { error, appId: app.id });

    return StoreActionResult.failure(ActionFailure.withLogHint(t("actions.uninstallFailed", { name: app.name })), true);
  }
};
