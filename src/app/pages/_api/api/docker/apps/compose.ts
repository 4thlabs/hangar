import { PassThrough } from "node:stream";
import { isAppOperation } from "#modules/apps/actions/app-operation.ts";
import { refuseAppOperation } from "#modules/apps/actions/app-operations.ts";
import { runComposeBatch } from "#modules/apps/compose-batch.ts";
import { apiError, apiRoute, apiStream } from "#app/api/api-route.ts";
import { logger } from "#libs/logs";

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

    if (!isAppOperation(operation) || projects.length === 0) {
      logger.warn("Docker Compose stream rejected", { operation, projects: projects.join(" ") });
      return apiError("La commande Docker Compose est invalide.", 400);
    }

    // Every app is checked before any of them runs: a batch that would be refused half-way is
    // refused whole, rather than leaving the caller to work out where it stopped.
    for (const project of projects) {
      const refusal = refuseAppOperation(project);

      if (refusal) {
        logger.warn("Docker Compose stream rejected", { project, operation, reason: refusal.reason });
        return apiError(refusal.message, refusal.reason === "invalid" ? 400 : 404);
      }
    }

    const output = new PassThrough();

    // The client may be long gone: without a reader the stream either buffers the whole batch in
    // memory or throws on a write, and neither may interrupt the commands. Compose resolves on
    // the child's exit, not on the pipe, so a broken pipe costs the output and nothing else.
    output.on("error", () => {});
    request.signal.addEventListener("abort", () => output.resume());

    // Not awaited: the batch outlives the request (see above), and its failures are reported
    // per app, as notifications.
    void runComposeBatch({ operation, projects, userId: session.user.id, output });

    return apiStream(output);
  },
);
