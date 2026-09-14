import type { ApiContext } from "waku/router";
import { dockerRoute } from "#app/api/docker-route.ts";
import { dockerTextStream, openDockerLogs } from "#libs/docker";
import { hangar } from "#libs/hangar/server";

export const GET = dockerRoute<ApiContext<"/api/docker/apps/[project]/containers/[container]/logs">>(
  {
    log: "Failed to stream Docker container logs",
    unavailable: "Les logs Docker sont indisponibles.",
    notFound: "Ce conteneur n’existe plus.",
  },
  async (request, { params }) =>
    // The request signal kills `docker logs -f`: closing the tab must not leave the child behind.
    dockerTextStream(await openDockerLogs(hangar.runtime, params.project, params.container, request.signal)),
);
