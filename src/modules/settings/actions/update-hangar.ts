"use server";

import { sessions } from "#libs/auth/server";
import { SelfUpdateUnavailableError } from "#libs/docker";
import { selfUpdate } from "#libs/docker/server";
import { ServerTranslation } from "#libs/i18n/server";
import { logger } from "#libs/logs";
import { ActionFailure } from "#modules/common/actions/action-failure.ts";
import { ActionResult, type ReadResult } from "#modules/common/actions/action-result.ts";
import { SettingsMessages } from "#modules/settings/messages.ts";

/** The image Hangar would pull to update itself, or why it cannot update itself where it runs. */
export const readHangarImage = async (): Promise<ReadResult<string>> => {
  await sessions.require();

  const { t } = ServerTranslation.get(SettingsMessages);

  try {
    return { success: true, value: (await selfUpdate.target()).image };
  } catch (error) {
    if (error instanceof SelfUpdateUnavailableError) {
      return { success: false, message: t(`hangar.unavailable.${error.reason}`) };
    }

    logger.error("Self-update target read failed", { error });

    return { success: false, message: ActionFailure.withLogHint(t("hangar.inspectFailed")) };
  }
};

/** Pulls Hangar's image and recreates its container, through a relay that outlives this process. */
export const updateHangar = async (): Promise<ActionResult> => {
  await sessions.require();

  const { t } = ServerTranslation.get(SettingsMessages);

  try {
    const { image } = await selfUpdate.start();

    logger.info(`Self-update started from ${image}`);

    // Nothing more comes back: if the registry has a newer image, this server stops in a moment.
    return ActionResult.success(t("hangar.startedMessage"));
  } catch (error) {
    if (error instanceof SelfUpdateUnavailableError) {
      return ActionResult.failure(t(`hangar.unavailable.${error.reason}`));
    }

    logger.error("Self-update failed to start", { error });

    return ActionResult.failure(ActionFailure.withLogHint(t("hangar.startError")));
  }
};
