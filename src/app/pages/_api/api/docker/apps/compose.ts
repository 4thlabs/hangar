import { logger } from "#libs/logs";
import { apiCommandStream, apiError, apiRoute } from "#app/api/api-route.ts";
import { AppCommands } from "#modules/apps/actions/app-operation.ts";
import { AppOperationGuard } from "#modules/apps/actions/app-operations.ts";
import { runComposeBatch } from "#modules/apps/compose-batch.ts";

/** Streams `docker compose <operation> [flags]` over the apps; the batch outlives the request, each app notifies its end. */
export const POST = apiRoute(
  { log: "Docker Compose stream failed to start", unavailable: "Le daemon Docker est indisponible." },
  async (request, _context, session) => {
    const parameters = new URL(request.url).searchParams;
    const operation = parameters.get("operation") ?? "";
    const flags = parameters.get("flags") ?? "";
    const command = AppCommands.parse(operation, flags);
    const projects = (parameters.get("projects") ?? "").split(",").filter(Boolean);

    if (!command || projects.length === 0) {
      logger.warn("Docker Compose stream rejected", { operation, flags, projects: projects.join(" ") });

      return apiError("La commande Docker Compose est invalide.", 400);
    }

    // All checked before any runs: a batch that would be refused half-way is refused whole.
    for (const project of projects) {
      const refusal = AppOperationGuard.refuse(project);

      if (refusal) {
        logger.warn("Docker Compose stream rejected", { project, operation, reason: refusal.reason });

        return apiError(refusal.message, refusal.reason === "invalid" ? 400 : 404);
      }
    }

    // Its failures are reported per app, as notifications.
    return apiCommandStream(output => runComposeBatch({ command, projects, userId: session.user.id, output }));
  },
);
