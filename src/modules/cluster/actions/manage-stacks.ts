"use server";

import { sessions } from "#libs/auth/server";
import { swarm } from "#libs/docker/server";
import { collectingOutput, HangarError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { ActionResult, SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";

/** A stack name as `docker stack` accepts it. */
const StackName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;

/** One task of a stack, as `docker stack ps --format json` prints it. */
export type StackTask = {
  ID: string;
  Name: string;
  Image: string;
  Node: string;
  DesiredState: string;
  CurrentState: string;
  Error: string;
};

/** The tasks of a stack, only on success. */
export type StackTasksResult = ActionResult & { tasks?: StackTask[] };

/**
 * The tasks of any stack in the swarm, deployed by Hangar or by hand, current and past (the failed
 * attempts are what explains a partial stack).
 */
export const readStackTasks = async (name: string): Promise<StackTasksResult> => {
  await sessions.require();

  if (!StackName.test(name)) {
    return ActionResult.failure("Nom de stack invalide.");
  }

  try {
    // prettier-ignore
    const { stdout } = await hangar.runtime.run("docker", [
      "stack", "ps", "--format", "json", "--no-trunc", name,
    ], { capture: true });

    const tasks = stdout
      .split("\n")
      .filter(line => line.trim() !== "")
      .map(line => JSON.parse(line) as StackTask);

    return { ...ActionResult.success(`${tasks.length} tâches.`), tasks };
  } catch (error) {
    return failure(error, "read", name);
  }
};

/** Deploys a stack again from its store files, to apply an edit or pull a moved tag. */
export const redeployStack = async (name: string): Promise<ActionResult> => {
  await sessions.require();

  const app = manageableApp(name);

  if (!app) {
    return ActionResult.failure(`${name} n’est pas une app du store prête pour le swarm.`);
  }

  try {
    await collectingOutput(pipe => hangar.store.stack(app.id, ["deploy", "--quiet"], { pipe }));
    await swarm.settle();

    return ActionResult.success(`${app.name} a été redéployée.`);
  } catch (error) {
    return failure(error, "redeploy", name);
  }
};

/**
 * Removes a stack from the swarm, and takes its app off `swarm:` so `swarm deploy` does not bring it
 * back. The app stays installed; it runs nowhere until deployed again.
 */
export const removeStack = async (name: string): Promise<ActionResult> => {
  await sessions.require();

  const app = manageableApp(name);

  if (!app) {
    return ActionResult.failure(`${name} n’est pas une app du store prête pour le swarm.`);
  }

  try {
    await collectingOutput(pipe => hangar.store.stack(app.id, ["rm"], { pipe }));
    await hangar.store.config.removeFromSwarm(app.id);
    await hangar.store.refresh();
    await swarm.settle();

    return ActionResult.success(`${app.name} a été retirée du swarm.`);
  } catch (error) {
    return failure(error, "remove", name);
  }
};

/** The store app a stack is named after, when Hangar can deploy it: installed, with a compose.swarm.yml. */
function manageableApp(name: string) {
  const app = hangar.store.app(name);

  return app?.installed && app.swarmReady ? app : undefined;
}

/** Docker's complaint as is, since it says what to fix; anything else is logged. */
function failure(error: unknown, operation: string, stack: string): ActionResult {
  if (error instanceof HangarError) {
    return ActionResult.failure(error.message);
  }

  logger.error(`Stack ${operation} failed`, { error, stack });

  return ActionResult.failure(`L’opération sur ${stack} a échoué. ${SERVER_LOG_HINT}`);
}
