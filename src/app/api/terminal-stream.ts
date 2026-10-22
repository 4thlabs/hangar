import type { TerminalShell, TerminalSize } from "#libs/terminals";
import { terminals } from "#libs/terminals/server";
import { TerminalMessages } from "#modules/common/terminal-messages.ts";
import { TerminalProtocol } from "#modules/common/terminal-protocol.ts";
import { apiError, apiStream } from "./api-route.ts";

/**
 * Starts a shell sized to the terminal the request describes, and streams its TTY, the session id in a
 * header; the input goes to `/api/terminals/[terminal]`. Called from inside `apiRoute`, which answers the
 * shell's `NotFoundError` with a 404.
 * @param start Starts the shell: in a container, or on the host
 */
export async function terminalStream(
  request: Request,
  owner: string,
  start: (size: TerminalSize) => Promise<TerminalShell>,
): Promise<Response> {
  const size = TerminalMessages.size.safeParse(await request.json().catch(() => null));

  if (!size.success) {
    return apiError("La taille du terminal est invalide.", 400);
  }

  const shell = await start(size.data);
  // The request signal closes the session: leaving the page must not leave the shell behind.
  const { id, output } = terminals.open(owner, shell, request.signal);

  return apiStream(output, {
    contentType: "application/octet-stream",
    headers: { [TerminalProtocol.IdHeader]: id },
  });
}
