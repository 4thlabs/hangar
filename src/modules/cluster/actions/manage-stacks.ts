"use server";

import { sessions } from "#libs/auth/server";
import type { SwarmStackTask } from "#libs/docker";
import { swarm } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { ServerTranslation } from "#libs/i18n/server";
import { SwarmFailure } from "#modules/cluster/actions/swarm-failure.ts";
import { ClusterMessages } from "#modules/cluster/messages.ts";
import { ActionResult, type ReadResult } from "#modules/common/actions/action-result.ts";

/** The tasks of any stack in the swarm, deployed by Hangar or by hand, current and past. */
export const readStackTasks = async (name: string): Promise<ReadResult<SwarmStackTask[]>> => {
  await sessions.require();

  try {
    return { success: true, value: await swarm.stackTasks(name) };
  } catch (error) {
    const { message } = SwarmFailure.from(error, "Stack tasks read failed", { stack: name });

    return { success: false, message };
  }
};

/** Removes a stack from the swarm. The app stays installed, and its compose project, if any, untouched. */
export const removeStack = async (name: string): Promise<ActionResult> => {
  await sessions.require();

  const { t } = ServerTranslation.get(ClusterMessages);

  if (!hangar.store.isStackManageable(name)) {
    return ActionResult.failure(t("actions.notManageable", { stack: name }));
  }

  try {
    await hangar.store.stack(name, ["rm"], { capture: true });

    return ActionResult.success(t("actions.stackRemoved", { stack: name }));
  } catch (error) {
    return SwarmFailure.from(error, "Stack removal failed", { stack: name });
  }
};
