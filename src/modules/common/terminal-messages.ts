import * as z from "zod";
import type { TerminalSize } from "#libs/terminals";
import { TerminalProtocol, type TerminalMessage } from "./terminal-protocol.ts";

/** What the terminal routes accept. */
export class TerminalMessages {
  /** Far beyond any screen; bounds what reaches the daemon. */
  private static readonly MaxCells = 1_000;

  /** A terminal's size, in character cells. */
  static readonly size = z.object({
    cols: z.int().min(1).max(TerminalMessages.MaxCells),
    rows: z.int().min(1).max(TerminalMessages.MaxCells),
  }) satisfies z.ZodType<TerminalSize>;

  /** One message to an open session: keystrokes, or the terminal's new size. */
  static readonly message = z.union([
    z.object({ input: z.string().min(1).max(TerminalProtocol.MaxInputLength) }),
    TerminalMessages.size,
  ]) satisfies z.ZodType<TerminalMessage>;
}
