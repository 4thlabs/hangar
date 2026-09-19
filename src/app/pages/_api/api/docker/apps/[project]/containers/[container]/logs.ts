import type { ApiContext } from "waku/router";
import { apiRoute, apiStream } from "#app/api/api-route.ts";
import { docker } from "#libs/docker/server";

export const GET = apiRoute<ApiContext<"/api/docker/apps/[project]/containers/[container]/logs">>(
  {
    log: "Failed to stream Docker container logs",
    unavailable: "Les logs Docker sont indisponibles.",
    notFound: "Ce conteneur n’existe plus.",
  },
  async (request, { params }) =>
    // The request signal kills `docker logs -f`: closing the tab must not leave the child behind.
    apiStream(await docker.openLogs(params.project, params.container, request.signal)),
);
