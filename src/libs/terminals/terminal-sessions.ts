import { randomUUID } from "node:crypto";
import { addAbortListener } from "node:events";
import { PassThrough, type Duplex, type Readable } from "node:stream";
import { NotFoundError } from "#libs/hangar";
import { logger } from "#libs/logs";

/** A terminal's size in character cells, as xterm measures it. */
export type TerminalSize = { cols: number; rows: number };

/** A shell with a TTY, as the backend that started it hands it over: in a container, or on a host over SSH. */
export interface TerminalShell {
  /** The TTY: what is written goes to the shell, what is read is its output. One stream, no framing. */
  readonly stream: Duplex;

  /** What the logs name the shell after, beside the session and its user: its container, or its host. */
  readonly target: Record<string, string>;

  /** Resizes the TTY, so full-screen programs redraw to the client's terminal. */
  resize(size: TerminalSize): Promise<void>;

  /** Ends the shell and what it started, once its stream is destroyed; called once per shell. */
  end(): Promise<void>;
}

/** What {@link TerminalSessions.open} hands the route: the id the input is sent to, and the TTY's output. */
export type OpenedTerminal = { id: string; output: Readable };

/** A session that is gone, or that belongs to someone else. A `NotFoundError`, so the routes answer 404. */
export class TerminalNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(`Terminal session ${id} not found`);
    this.name = "TerminalNotFoundError";
  }
}

type TerminalSession = {
  owner: string;
  shell: TerminalShell;
  output: PassThrough;
  heartbeat: NodeJS.Timeout;
};

/**
 * The open terminals, by session id: a shell whose output streams to the request that opened it, and whose
 * input and resizes arrive in requests of their own. In memory: Hangar is one process.
 *
 * No `server-only` guard: see AGENTS.md § server-only.
 */
export class TerminalSessions {
  /**
   * How often an idle session sends {@link Heartbeat}: under the idle timeout of the usual proxies (60 s for
   * nginx and Traefik), which would end the response, and with it the shell.
   */
  private static readonly HeartbeatMs = 30_000;

  /** A byte the terminal ignores (NUL), so the stream never goes silent. */
  private static readonly Heartbeat = "\0";

  private readonly sessions = new Map<string, TerminalSession>();

  /**
   * Hands a started shell to `owner`, under a new session id.
   * @param signal Aborted when the client stops reading; closes the session, even if it aborted already
   */
  open(owner: string, shell: TerminalShell, signal: AbortSignal): OpenedTerminal {
    const id = randomUUID();
    const output = new PassThrough();

    const heartbeat = setInterval(() => output.write(TerminalSessions.Heartbeat), TerminalSessions.HeartbeatMs);

    this.sessions.set(id, { owner, shell, output, heartbeat });
    logger.info("Terminal opened", { terminal: id, user: owner, ...shell.target });

    shell.stream.pipe(output);
    shell.stream.on("error", error => logger.warn("A terminal stream failed", { error, terminal: id }));
    // The shell exited, or its connection dropped.
    shell.stream.on("close", () => void this.close(id));

    // Also called when the client left while the shell started, which a plain listener would miss.
    addAbortListener(signal, () => void this.close(id));

    return { id, output };
  }

  /**
   * Types into a session's shell.
   * @throws {TerminalNotFoundError} if the session is gone or belongs to someone else
   */
  write(id: string, owner: string, input: string): void {
    this.session(id, owner).shell.stream.write(input);
  }

  /**
   * Resizes a session's TTY.
   * @throws {TerminalNotFoundError} if the session is gone or belongs to someone else
   */
  async resize(id: string, owner: string, size: TerminalSize): Promise<void> {
    await this.session(id, owner).shell.resize(size);
  }

  /** A session of `owner`; someone else's reads as missing, so ids cannot be probed. */
  private session(id: string, owner: string): TerminalSession {
    const session = this.sessions.get(id);

    if (!session || session.owner !== owner) {
      throw new TerminalNotFoundError(id);
    }

    return session;
  }

  /** Forgets a session and ends its shell. Called by both the client leaving and the shell exiting. */
  private async close(id: string): Promise<void> {
    const session = this.sessions.get(id);

    if (!session) {
      return;
    }

    this.sessions.delete(id);
    clearInterval(session.heartbeat);
    session.shell.stream.destroy();
    session.output.end();
    logger.info("Terminal closed", { terminal: id, user: session.owner });

    try {
      await session.shell.end();
    } catch (error) {
      logger.warn("Could not end a terminal's shell", { error, terminal: id, ...session.shell.target });
    }
  }
}
