import { PassThrough } from "node:stream";
import type { ApiContext } from "waku/router";
import { isAppOperation } from "#app/actions/apps/app-operation.ts";
import { appOperationArguments, refuseAppOperation } from "#app/actions/apps/app-operations.ts";
import { COMPOSE_EXIT_MARKER } from "#app/actions/apps/compose-stream.ts";
import { dockerRoute } from "#app/api/docker-route.ts";
import { dockerError, dockerTextStream } from "#libs/docker";
import { HangarRuntimeError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";

const exitCode = (error: unknown) => (error instanceof HangarRuntimeError ? error.code : 1);

/**
 * Streams `docker compose <operation>` for one app as plain text, live.
 * Aborting the request stops the streaming only: the compose command keeps running,
 * closing a tab must not leave a stack half-way up.
 */
export const POST = dockerRoute<ApiContext<"/api/docker/apps/[project]/compose">>(
  { log: "Docker Compose stream failed to start", unavailable: "Le daemon Docker est indisponible." },
  async (request, { params }) => {
    const project = params.project;
    const operation = new URL(request.url).searchParams.get("operation") ?? "";

    // Checked before `refuseAppOperation` so `operation` narrows to an `AppOperation` below.
    if (!isAppOperation(operation)) {
      logger.warn({ project, operation }, "Docker Compose stream rejected");
      return dockerError("La commande Docker Compose est invalide.", 400);
    }

    const refusal = refuseAppOperation(project, operation);

    if (refusal) {
      logger.warn({ project, operation, reason: refusal.reason }, "Docker Compose stream rejected");
      return dockerError(refusal.message, refusal.reason === "invalid" ? 400 : 404);
    }

    const output = new PassThrough();

    void hangar.store
      .compose(project, [...appOperationArguments[operation]], { pipe: output })
      .then(() => output.end(`\n${COMPOSE_EXIT_MARKER}0\n`))
      .catch((error: unknown) => {
        logger.error({ error, project, operation }, "Docker Compose stream command failed");
        output.end(`\n${COMPOSE_EXIT_MARKER}${exitCode(error)}\n`);
      });

    return dockerTextStream(output);
  },
);
