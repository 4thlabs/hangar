import type { Writable } from "node:stream";

/**
 * The outcome line a command stream route (compose operations, stack deploys) writes last: the HTTP
 * status is committed before the command exits, so this marker carries the real outcome to the client.
 */
export class CommandStream {
  private static readonly ExitMarker = "[hangar] exit=";

  /**
   * Writes the marker and ends the stream.
   * @param failures How many commands failed: zero still means "everything went through"
   */
  static end(output: Writable, failures: number) {
    output.end(`\n${CommandStream.ExitMarker}${failures}\n`);
  }

  /** Reads the exit code out of a finished stream, `null` while it is still running. */
  static exitCode(output: string): number | null {
    const marker = output.lastIndexOf(CommandStream.ExitMarker);

    if (marker === -1) {
      return null;
    }

    const code = Number.parseInt(output.slice(marker + CommandStream.ExitMarker.length), 10);

    return Number.isFinite(code) ? code : null;
  }
}
