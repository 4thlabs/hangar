import type { ApiContext } from "waku/router";
import { ServerTranslation } from "#libs/i18n/server";
import { terminals } from "#libs/terminals/server";
import { apiError, apiRoute } from "#app/api/api-route.ts";
import { ApiMessages } from "#app/api/messages.ts";
import { TerminalMessages } from "#modules/common/terminal-messages.ts";

/** Types into an open terminal, or resizes it. */
export const POST = apiRoute<ApiContext<"/api/terminals/[terminal]">>(
  {
    log: "Failed to reach a terminal",
    unavailable: "terminal",
    notFound: "terminal",
  },
  async (request, { params }, session) => {
    const message = TerminalMessages.message.safeParse(await request.json().catch(() => null));

    if (!message.success) {
      return apiError(ServerTranslation.get(ApiMessages).t("invalidTerminalMessage"), 400);
    }

    if ("input" in message.data) {
      terminals.write(params.terminal, session.user.id, message.data.input);
    } else {
      await terminals.resize(params.terminal, session.user.id, message.data);
    }

    return new Response(null, { status: 204 });
  },
);

/** Ends a terminal and its shell, from a container's **Close the session**. */
export const DELETE = apiRoute<ApiContext<"/api/terminals/[terminal]">>(
  {
    log: "Failed to close a terminal",
    unavailable: "terminal",
    notFound: "terminal",
  },
  async (_request, { params }, session) => {
    await terminals.close(params.terminal, session.user.id);

    return new Response(null, { status: 204 });
  },
);
