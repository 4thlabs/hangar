import type { ApiContext } from "waku/router";
import { terminals } from "#libs/docker/server";
import { apiError, apiRoute, apiStream } from "#app/api/api-route.ts";
import { TerminalMessages } from "#modules/apps/terminal-messages.ts";
import { TerminalProtocol } from "#modules/apps/terminal-protocol.ts";

/** Opens a shell in the container and streams its TTY; the input goes to `/api/docker/terminals/[terminal]`. */
export const POST = apiRoute<ApiContext<"/api/docker/apps/[project]/containers/[container]/terminal">>(
  {
    log: "Failed to open a container terminal",
    unavailable: "Le terminal est indisponible.",
    notFound: "Ce conteneur n’existe plus.",
  },
  async (request, { params }, session) => {
    const size = TerminalMessages.size.safeParse(await request.json().catch(() => null));

    if (!size.success) {
      return apiError("La taille du terminal est invalide.", 400);
    }

    // The request signal closes the session: leaving the tab must not leave the shell behind.
    const { id, output } = await terminals.open(
      { owner: session.user.id, project: params.project, containerId: params.container },
      size.data,
      request.signal,
    );

    return apiStream(output, {
      contentType: "application/octet-stream",
      headers: { [TerminalProtocol.IdHeader]: id },
    });
  },
);
