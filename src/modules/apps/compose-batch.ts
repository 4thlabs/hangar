import type { Writable } from "node:stream";
import { actionLabel, operationOutcome, type AppOperation } from "#modules/apps/actions/app-operation.ts";
import { appOperationArguments } from "#modules/apps/actions/app-operations.ts";
import { COMPOSE_EXIT_MARKER } from "#modules/apps/actions/compose-stream.ts";
import { SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";
import { docker } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { notifications } from "#libs/notifications/server";

type ComposeBatch = {
  operation: AppOperation;
  /** The apps to run it on, in order, already checked by `refuseAppOperation`. */
  projects: readonly string[];
  /** Who gets a notification as each app finishes. */
  userId: string;
  /** Where every command's output goes, ended with the exit marker once the batch is done. */
  output: Writable;
};

/**
 * Runs `docker compose <operation>` on each app in turn. One app failing does not stop the
 * others: each files its own notification, which is what the user reads when they come back.
 */
export async function runComposeBatch({ operation, projects, userId, output }: ComposeBatch) {
  let failures = 0;

  for (const project of projects) {
    const succeeded = await runOne(operation, project, userId, output);

    if (!succeeded) failures += 1;
  }

  // The marker carries the number of failed apps, so `composeExitCode` keeps its meaning:
  // zero is still "everything went through".
  output.end(`\n${COMPOSE_EXIT_MARKER}${failures}\n`);
}

/** Runs the command on one app and notifies its outcome. Resolves to whether it succeeded. */
async function runOne(operation: AppOperation, project: string, userId: string, output: Writable) {
  const label = actionLabel[operation];
  const href = `/apps/${project}`;

  output.write(`\n$ docker compose ${appOperationArguments[operation].join(" ")} — ${project}\n`);

  // The client reloads the page on this app's notification and again when the batch ends, so
  // what `/apps` reads is reloaded before either goes out: the reload is then served the new state
  // from memory, neither the old one nor a spinner. Not the overview: `df` is slow, only the
  // dashboard reads it, and the daemon's events refresh it anyway. Unconditional: a compose run
  // that fails half-way still leaves containers it did start.
  try {
    await hangar.store
      .compose(project, [...appOperationArguments[operation]], { pipe: output })
      .finally(() => docker.refresh(["containers", "images"]));
  } catch (error) {
    logger.error("Docker Compose stream command failed", { error, project, operation });
    await notifications.notify({
      userId,
      level: "error",
      title: `${label} échoué`,
      description: `La commande Docker Compose a échoué pour ${project}. ${SERVER_LOG_HINT}`,
      href,
    });

    return false;
  }

  await notifications.notify({
    userId,
    level: "success",
    title: `${label} terminé`,
    description: operationOutcome[operation](project),
    href,
  });

  return true;
}
