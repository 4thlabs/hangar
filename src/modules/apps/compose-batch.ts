import type { Writable } from "node:stream";
import { docker } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { notifications } from "#libs/notifications/server";
import { AppCommands, type AppCommand } from "#modules/apps/actions/app-operation.ts";
import { CommandStream } from "#modules/common/command-stream.ts";
import { NotificationText } from "#modules/notifications/notification-text.ts";

type ComposeBatch = {
  command: AppCommand;
  /** The apps to run it on, in order, already checked by `AppOperationGuard.refuse`. */
  projects: readonly string[];
  /** Who gets a notification as each app finishes. */
  userId: string;
  /** Where every command's output goes, ended with the exit marker once the batch is done. */
  output: Writable;
};

/**
 * Runs the compose command on each app in turn. One app failing does not stop the
 * others: each files its own notification, which is what the user reads when they come back.
 */
export async function runComposeBatch({ command, projects, userId, output }: ComposeBatch) {
  let failures = 0;

  for (const project of projects) {
    const succeeded = await runOne(command, project, userId, output);

    if (!succeeded) {
      failures += 1;
    }
  }

  CommandStream.end(output, failures);
}

/** Runs the command on one app and notifies its outcome. Resolves to whether it succeeded. */
async function runOne(command: AppCommand, project: string, userId: string, output: Writable) {
  const href = `/apps/${project}`;
  const run = { project, operation: command.operation, flags: command.flags.join(",") };

  output.write(`\n$ ${AppCommands.commandLine(command)} — ${project}\n`);

  // Settled before the notification goes out, so the client's reload is served the new state, not a spinner;
  // always, since a run that fails half-way still leaves containers it started.
  try {
    await hangar.store
      .compose(project, AppCommands.arguments(command), { pipe: output })
      .finally(() => docker.settle());
  } catch (error) {
    logger.error("Docker Compose stream command failed", { error, project, command: AppCommands.commandLine(command) });
    await notifications.notify({
      userId,
      level: "error",
      message: NotificationText.create("composeFailed", run),
      href,
    });

    return false;
  }

  await notifications.notify({
    userId,
    level: "success",
    message: NotificationText.create("composeSucceeded", run),
    href,
  });

  return true;
}
