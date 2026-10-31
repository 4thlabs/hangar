import { ServerTranslation } from "#libs/i18n/server";
import type { OpenedTerminal, TerminalSize } from "#libs/terminals";
import { TerminalMessages } from "#modules/common/terminal-messages.ts";
import { TerminalProtocol } from "#modules/common/terminal-protocol.ts";
import { apiError, apiStream } from "./api-route.ts";
import { ApiMessages } from "./messages.ts";

/**
 * Opens a session sized to the terminal the request describes, and streams its TTY, the session id in a
 * header; the input goes to `/api/terminals/[terminal]`. Called from inside `apiRoute`, which answers the
 * shell's `NotFoundError` with a 404.
 * @param open Opens the session through `terminals`: one that ends with the client (a container's), or one
 *   kept for the next (the host's). The signal is the request's: leaving the page is what it acts on.
 */
export async function terminalStream(
  request: Request,
  open: (size: TerminalSize, signal: AbortSignal) => Promise<OpenedTerminal>,
): Promise<Response> {
  const size = TerminalMessages.size.safeParse(await request.json().catch(() => null));

  if (!size.success) {
    return apiError(ServerTranslation.get(ApiMessages).t("invalidTerminalSize"), 400);
  }

  const { id, output, replayedBytes } = await open(size.data, request.signal);

  return apiStream(output, {
    contentType: "application/octet-stream",
    headers: { [TerminalProtocol.IdHeader]: id, [TerminalProtocol.ReplayHeader]: String(replayedBytes) },
  });
}
