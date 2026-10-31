import { ServerTranslation } from "#libs/i18n/server";
import { hostShells } from "#libs/ssh/server";
import { terminals } from "#libs/terminals/server";
import { apiError, apiRoute } from "#app/api/api-route.ts";
import { ApiMessages } from "#app/api/messages.ts";
import { terminalStream } from "#app/api/terminal-stream.ts";
import { TerminalMessages } from "#modules/terminal/messages.ts";

/**
 * Streams the user's terminal on the host, opening it the first time: it outlives the page, which finds it
 * again on return. Hangar signs in from the terminal itself, asking there for the password: it reaches the
 * session as keystrokes, and is neither stored nor logged.
 */
export const POST = apiRoute(
  {
    log: "Failed to open the host terminal",
    unavailable: "terminal",
  },
  async (request, _context, session) => {
    // A local, so the check below narrows it in the callback too: TypeScript does not narrow an import there.
    const shells = hostShells;

    if (!shells) {
      return apiError(ServerTranslation.get(ApiMessages).t("noHost"), 404);
    }

    // The words of the language the terminal opens in: a session kept past a switch keeps the ones it began with.
    const { t, locale } = ServerTranslation.get(TerminalMessages);
    const words = TerminalMessages[locale].shell;

    return terminalStream(request, (size, signal) =>
      terminals.attach(session.user.id, shells.address, size, () => shells.open(size, words), signal, t("takenOver")),
    );
  },
);
