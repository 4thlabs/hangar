import type { ApiContext } from "waku/router";
import { swarm } from "#libs/docker/server";
import { apiRoute, apiStream } from "#app/api/api-route.ts";

export const GET = apiRoute<ApiContext<"/api/docker/swarm/stacks/[stack]/services/[service]/logs">>(
  {
    log: "Failed to stream Swarm service logs",
    unavailable: "Les logs du service sont indisponibles.",
    notFound: "Ce service n’existe plus.",
  },
  async (request, { params }) =>
    // The request signal ends the daemon's follow: closing the tab must not leave the stream behind.
    apiStream(await swarm.openServiceLogs(params.stack, params.service, request.signal)),
);
