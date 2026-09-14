import type { ApiContext } from "waku/router";
import { dockerRoute, dockerStream } from "#app/api/docker-route.ts";
import { openDockerLogs } from "#libs/docker/logs.ts";

export const GET = dockerRoute<ApiContext<"/api/docker/apps/[project]/containers/[container]/logs">>(
  {
    log: "Failed to stream Docker container logs",
    unavailable: "Les logs Docker sont indisponibles.",
    notFound: "Ce conteneur n’existe plus.",
  },
  async (request, { params }) =>
    // The request signal kills `docker logs -f`: closing the tab must not leave the child behind.
    dockerStream(await openDockerLogs(params.project, params.container, request.signal)),
);
