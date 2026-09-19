import { PassThrough } from "node:stream";
import { SERVER_LOG_HINT } from "#app/actions/action-result.ts";
import { actionLabel, isAppOperation, operationOutcome } from "#app/actions/apps/app-operation.ts";
import { appOperationArguments, refuseAppOperation } from "#app/actions/apps/app-operations.ts";
import { COMPOSE_EXIT_MARKER } from "#app/actions/apps/compose-stream.ts";
import { apiError, apiRoute, apiStream } from "#app/api/api-route.ts";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { notifications } from "#libs/notifications/server";

/**
 * Streams `docker compose <operation>` over one or more apps as plain text, live.
 *
 * The loop runs server-side on purpose: aborting the request stops the streaming only, so
 * closing the tab mid-batch still leaves the remaining apps to be processed rather than
 * dropping them. Each app files a notification when its command ends — that is what the user
 * reads when they come back.
 */
export const POST = apiRoute(
  { log: "Docker Compose stream failed to start", unavailable: "Le daemon Docker est indisponible." },
  async (request, _context, session) => {
    const parameters = new URL(request.url).searchParams;
    const operation = parameters.get("operation") ?? "";
    const projects = (parameters.get("projects") ?? "").split(",").filter(Boolean);

    // Checked before `refuseAppOperation` so `operation` narrows to an `AppOperation` below.
    if (!isAppOperation(operation) || projects.length === 0) {
      logger.warn("Docker Compose stream rejected", { operation, projects: projects.join(" ") });
      return apiError("La commande Docker Compose est invalide.", 400);
    }

    // Every app is checked before any of them runs: a batch that would be refused half-way is
    // refused whole, rather than leaving the caller to work out where it stopped.
    for (const project of projects) {
      const refusal = refuseAppOperation(project, operation);

      if (refusal) {
        logger.warn("Docker Compose stream rejected", { project, operation, reason: refusal.reason });
        return apiError(refusal.message, refusal.reason === "invalid" ? 400 : 404);
      }
    }

    const output = new PassThrough();
    const label = actionLabel[operation];

    // The client may be long gone: without a reader the stream either buffers the whole batch in
    // memory or throws on a write, and neither may interrupt the commands. Compose resolves on
    // the child's exit, not on the pipe, so a broken pipe costs the output and nothing else.
    output.on("error", () => {});
    request.signal.addEventListener("abort", () => output.resume());

    void (async () => {
      let failures = 0;

      for (const project of projects) {
        output.write(`\n$ docker compose ${appOperationArguments[operation].join(" ")} — ${project}\n`);

        try {
          await hangar.store.compose(project, [...appOperationArguments[operation]], { pipe: output });
          await notifications.notify({
            userId: session.user.id,
            level: "success",
            title: `${label} terminé`,
            description: operationOutcome[operation](project),
            href: `/apps/${project}`,
          });
        } catch (error) {
          failures += 1;
          logger.error("Docker Compose stream command failed", { error, project, operation });
          await notifications.notify({
            userId: session.user.id,
            level: "error",
            title: `${label} échoué`,
            description: `La commande Docker Compose a échoué pour ${project}. ${SERVER_LOG_HINT}`,
            href: `/apps/${project}`,
          });
        }
      }

      // The marker carries the number of failed apps, so `composeExitCode` keeps its meaning:
      // zero is still "everything went through".
      output.end(`\n${COMPOSE_EXIT_MARKER}${failures}\n`);
    })();

    return apiStream(output);
  },
);
