import "server-only";
import { TerminalSessions } from "../terminal-sessions.ts";

// Reused across HMR reloads, or a reload would orphan the shells still open.
const globalForTerminals = globalThis as unknown as { terminals?: TerminalSessions };

/** Every terminal open on the web server, whatever runs the shell: a container, or the host over SSH. */
export const terminals = globalForTerminals.terminals ?? new TerminalSessions();

globalForTerminals.terminals = terminals;
