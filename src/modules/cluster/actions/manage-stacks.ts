"use server";

import { sessions } from "#libs/auth/server";
import type { SwarmStackTask } from "#libs/docker";
import { swarm } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { swarmFailure } from "#modules/cluster/actions/swarm-failure.ts";
import { ActionResult, type ReadResult } from "#modules/common/actions/action-result.ts";

/** The tasks of any stack in the swarm, deployed by Hangar or by hand, current and past. */
export const readStackTasks = async (name: string): Promise<ReadResult<SwarmStackTask[]>> => {
  await sessions.require();

  try {
    return { success: true, value: await swarm.stackTasks(name) };
  } catch (error) {
    const { message } = swarmFailure(error, "Stack tasks read failed", { stack: name });

    return { success: false, message };
  }
};

/**
 * Deploys a stack again from its store files, to apply an edit or pull a moved tag. The events bring
 * the new services to /cluster.
 */
export const redeployStack = async (name: string): Promise<ActionResult> => {
  await sessions.require();

  if (!hangar.store.isStackManageable(name)) {
    return ActionResult.failure(`${name} n’est pas une app du store prête pour le swarm.`);
  }

  try {
    await hangar.store.stack(name, ["deploy", "--quiet"], { capture: true });

    return ActionResult.success(`${name} a été redéployée.`);
  } catch (error) {
    return swarmFailure(error, "Stack redeploy failed", { stack: name });
  }
};

/** Removes a stack from the swarm and takes its app off `swarm:`; the app stays installed. */
export const removeStack = async (name: string): Promise<ActionResult> => {
  await sessions.require();

  if (!hangar.store.isStackManageable(name)) {
    return ActionResult.failure(`${name} n’est pas une app du store prête pour le swarm.`);
  }

  try {
    await hangar.store.removeFromSwarm(name, { capture: true });

    return ActionResult.success(`${name} a été retirée du swarm.`);
  } catch (error) {
    return swarmFailure(error, "Stack removal failed", { stack: name });
  }
};
