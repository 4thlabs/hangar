import { hostShells } from "#libs/ssh/server";
import { apiError, apiRoute } from "#app/api/api-route.ts";
import { terminalStream } from "#app/api/terminal-stream.ts";

/**
 * Opens a terminal on the host and streams it. Hangar signs in from the terminal itself, asking there for the
 * password: it reaches the session as keystrokes, and is neither stored nor logged.
 */
export const POST = apiRoute(
  {
    log: "Failed to open the host terminal",
    unavailable: "Le terminal est indisponible.",
  },
  async (request, _context, session) => {
    // A local, so the check below narrows it in the callback too: TypeScript does not narrow an import there.
    const shells = hostShells;

    if (!shells) {
      return apiError("Aucun serveur n’est configuré : renseignez HANGAR_SSH_HOST et HANGAR_SSH_USER.", 404);
    }

    return terminalStream(request, session.user.id, size => shells.open(size));
  },
);
