import type { ApiContext } from "waku/router";
import { terminals } from "#libs/terminals/server";
import { apiError, apiRoute } from "#app/api/api-route.ts";
import { TerminalMessages } from "#modules/common/terminal-messages.ts";

/** Types into an open terminal, or resizes it. */
export const POST = apiRoute<ApiContext<"/api/terminals/[terminal]">>(
  {
    log: "Failed to reach a terminal",
    unavailable: "Le terminal est indisponible.",
    notFound: "Ce terminal est fermé.",
  },
  async (request, { params }, session) => {
    const message = TerminalMessages.message.safeParse(await request.json().catch(() => null));

    if (!message.success) {
      return apiError("Le message du terminal est invalide.", 400);
    }

    if ("input" in message.data) {
      terminals.write(params.terminal, session.user.id, message.data.input);
    } else {
      await terminals.resize(params.terminal, session.user.id, message.data);
    }

    return new Response(null, { status: 204 });
  },
);
