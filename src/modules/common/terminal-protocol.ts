import type { TerminalSize } from "#libs/terminals";

/** One message to an open session: keystrokes, or the terminal's new size. */
export type TerminalMessage = { input: string } | TerminalSize;

/** How the browser and the terminal routes talk. Free of zod, which only the routes need to check it. */
export class TerminalProtocol {
  /** The response header carrying the id of the session a terminal stream belongs to. */
  static readonly IdHeader = "X-Terminal-Id";

  /**
   * The response header giving how many bytes of earlier output the stream starts with, replayed from a kept
   * session: the terminal answers none of the queries they hold, already answered once.
   */
  static readonly ReplayHeader = "X-Terminal-Replay";

  /** A large paste; what is typed while a request is in flight goes in the next one. */
  static readonly MaxInputLength = 64 * 1_024;

  /** Where an open session takes its messages. */
  static sessionEndpoint(id: string): string {
    return `/api/terminals/${encodeURIComponent(id)}`;
  }
}
