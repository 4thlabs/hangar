import type { ApiContext } from "waku/router";
import { containerShells } from "#libs/docker/server";
import { terminals } from "#libs/terminals/server";
import { apiRoute } from "#app/api/api-route.ts";
import { terminalStream } from "#app/api/terminal-stream.ts";

/** Opens a shell in the container and streams its TTY; leaving the page ends it. */
export const POST = apiRoute<ApiContext<"/api/docker/apps/[project]/containers/[container]/terminal">>(
  {
    log: "Failed to open a container terminal",
    unavailable: "terminal",
    notFound: "container",
  },
  async (request, { params }, session) =>
    terminalStream(request, async (size, signal) => {
      const shell = await containerShells.open({ project: params.project, containerId: params.container }, size);

      return terminals.open(session.user.id, shell, signal);
    }),
);
