import { PassThrough } from "node:stream";
import { logger } from "#libs/logs";
import { apiError, apiRoute, apiStream } from "#app/api/api-route.ts";
import { isAppOperation } from "#modules/apps/actions/app-operation.ts";
import { refuseAppOperation } from "#modules/apps/actions/app-operations.ts";
import { runComposeBatch } from "#modules/apps/compose-batch.ts";

/** Streams `docker compose <operation>` over the apps; the batch outlives the request, each app notifies its end. */
export const POST = apiRoute(
  { log: "Docker Compose stream failed to start", unavailable: "Le daemon Docker est indisponible." },
  async (request, _context, session) => {
    const parameters = new URL(request.url).searchParams;
    const operation = parameters.get("operation") ?? "";
    const projects = (parameters.get("projects") ?? "").split(",").filter(Boolean);

    if (!isAppOperation(operation) || projects.length === 0) {
      logger.warn("Docker Compose stream rejected", { operation, projects: projects.join(" ") });

      return apiError("La commande Docker Compose est invalide.", 400);
    }

    // All checked before any runs: a batch that would be refused half-way is refused whole.
    for (const project of projects) {
      const refusal = refuseAppOperation(project);

      if (refusal) {
        logger.warn("Docker Compose stream rejected", { project, operation, reason: refusal.reason });

        return apiError(refusal.message, refusal.reason === "invalid" ? 400 : 404);
      }
    }

    const output = new PassThrough();

    // Without a reader the stream would buffer the whole batch or throw on a write; neither may stop the commands.
    output.on("error", () => {});
    request.signal.addEventListener("abort", () => output.resume());

    // Not awaited: its failures are reported per app, as notifications.
    void runComposeBatch({ operation, projects, userId: session.user.id, output });

    return apiStream(output);
  },
);
