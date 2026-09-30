/**
 * Last line written by the compose stream route: the HTTP status is committed before
 * `docker compose` exits, so this marker carries the real outcome to the client.
 */
export const COMPOSE_EXIT_MARKER = "[hangar] exit=";

/** Reads the exit code out of a finished compose stream, `null` while it is still running */
export const composeExitCode = (output: string): number | null => {
  const marker = output.lastIndexOf(COMPOSE_EXIT_MARKER);
  if (marker === -1) return null;

  const code = Number.parseInt(output.slice(marker + COMPOSE_EXIT_MARKER.length), 10);
  return Number.isFinite(code) ? code : null;
};
