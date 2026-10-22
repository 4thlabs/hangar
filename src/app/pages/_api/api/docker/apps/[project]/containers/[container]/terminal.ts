import type { ApiContext } from "waku/router";
import { containerShells } from "#libs/docker/server";
import { apiRoute } from "#app/api/api-route.ts";
import { terminalStream } from "#app/api/terminal-stream.ts";

/** Opens a shell in the container and streams its TTY. */
export const POST = apiRoute<ApiContext<"/api/docker/apps/[project]/containers/[container]/terminal">>(
  {
    log: "Failed to open a container terminal",
    unavailable: "Le terminal est indisponible.",
    notFound: "Ce conteneur n’existe plus.",
  },
  async (request, { params }, session) =>
    terminalStream(request, session.user.id, size =>
      containerShells.open({ project: params.project, containerId: params.container }, size),
    ),
);
