import { randomUUID } from "node:crypto";
import { addAbortListener } from "node:events";
import { PassThrough, type Duplex, type Readable } from "node:stream";
import { NotFoundError } from "#libs/hangar";
import { logger } from "#libs/logs";
import { TerminalScrollback } from "./terminal-scrollback.ts";

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

/**
 * What {@link TerminalSessions.open} hands the route: the id the input is sent to, and the TTY's output,
 * starting with `replayedBytes` of earlier output when a kept session is attached again.
 */
export type OpenedTerminal = { id: string; output: Readable; replayedBytes: number };

/** A session that is gone, or that belongs to someone else. A `NotFoundError`, so the routes answer 404. */
export class TerminalNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(`Terminal session ${id} not found`);
    this.name = "TerminalNotFoundError";
  }
}

/** The client reading a session: the response its output streams to. */
type Attachment = {
  output: PassThrough;
  heartbeat: NodeJS.Timeout;
};

/** What a kept session holds while no client reads it. */
type Keeping = {
  /** `owner` and name, as {@link TerminalSessions.attach} finds the session again. */
  key: string;
  scrollback: TerminalScrollback;
  /** Ends the session once idle; restarted by each keystroke, resize or output, with a client or without. */
  idleTimeout: NodeJS.Timeout;
};

type TerminalSession = {
  owner: string;
  shell: TerminalShell;
  attachment: Attachment | null;
  /** `null` for a session that ends with its client. */
  keeping: Keeping | null;
};

/**
 * The open terminals, by session id: a shell whose output streams to the client reading it, and whose
 * input and resizes arrive in requests of their own. In memory: Hangar is one process.
 *
 * A session either ends with its client ({@link open}: a container's shell) or is kept for the next one
 * ({@link attach}: the host's), the way `tmux` keeps a session: one client at a time, the latest output
 * replayed to it.
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

  /**
   * How long a kept session may go without a keystroke, a resize or output before its shell is ended: a
   * forgotten shell does not linger.
   */
  private static readonly KeptIdleMs = 60 * 60_000;

  /** The output replayed to a reattaching client: a few full screens of a busy program, and then some. */
  private static readonly ScrollbackBytes = 256 * 1_024;

  /** Shown to the client a kept session was taken from, before its output ends. */
  private static readonly TakenOver = "\r\n\x1b[2mSession reprise dans un autre onglet.\x1b[0m\r\n";

  private readonly sessions = new Map<string, TerminalSession>();

  /** Kept sessions, by owner and name. */
  private readonly kept = new Map<string, string>();

  /** Kept sessions whose shell is starting, by owner and name: two clients arriving at once share one. */
  private readonly starting = new Map<string, Promise<string>>();

  /**
   * Hands a started shell to `owner`, under a new session id; it ends when the client leaves.
   * @param signal Aborted when the client stops reading; closes the session, even if it aborted already
   */
  open(owner: string, shell: TerminalShell, signal: AbortSignal): OpenedTerminal {
    const id = this.add(owner, shell, null);

    return this.connect(id, owner, signal);
  }

  /**
   * Hands `owner` their session called `name`, starting its shell the first time. The session outlives its
   * client: the next one gets the latest output, then the shell, sized to it. A client arriving while
   * another reads takes the session over, and the first one's output ends.
   * @param size The client's terminal: an existing shell is resized to it
   * @param start Starts the shell, sized to the client's terminal
   * @param signal Aborted when the client stops reading; the session then waits for the next one
   */
  async attach(
    owner: string,
    name: string,
    size: TerminalSize,
    start: () => Promise<TerminalShell>,
    signal: AbortSignal,
  ): Promise<OpenedTerminal> {
    const key = `${owner}\0${name}`;
    const existing = this.kept.get(key);
    const id = existing ?? (await this.startKept(key, owner, start));

    if (existing) {
      await this.resize(id, owner, size);
      logger.info("Terminal reattached", { terminal: id, user: owner });
    }

    // The shell may have exited meanwhile: the session is then gone, and the client gets a 404.
    return this.connect(id, owner, signal);
  }

  /**
   * Types into a session's shell.
   * @throws {TerminalNotFoundError} if the session is gone or belongs to someone else
   */
  write(id: string, owner: string, input: string): void {
    const session = this.session(id, owner);

    session.keeping?.idleTimeout.refresh();
    session.shell.stream.write(input);
  }

  /**
   * Resizes a session's TTY.
   * @throws {TerminalNotFoundError} if the session is gone or belongs to someone else
   */
  async resize(id: string, owner: string, size: TerminalSize): Promise<void> {
    const session = this.session(id, owner);

    session.keeping?.idleTimeout.refresh();
    await session.shell.resize(size);
  }

  /**
   * Ends a session at its owner's request.
   * @throws {TerminalNotFoundError} if the session is gone or belongs to someone else
   */
  async close(id: string, owner: string): Promise<void> {
    this.session(id, owner);
    await this.end(id);
  }

  /**
   * Ends every session of `owner`, kept or not, when they sign out: a kept shell, signed in on the host, must
   * not wait for whoever signs in to Hangar next.
   */
  async closeAll(owner: string): Promise<void> {
    const owned = [...this.sessions].filter(([, session]) => session.owner === owner).map(([id]) => id);

    await Promise.all(owned.map(id => this.end(id)));
  }

  /** A session of `owner`; someone else's reads as missing, so ids cannot be probed. */
  private session(id: string, owner: string): TerminalSession {
    const session = this.sessions.get(id);

    if (!session || session.owner !== owner) {
      throw new TerminalNotFoundError(id);
    }

    return session;
  }

  private startKept(key: string, owner: string, start: () => Promise<TerminalShell>): Promise<string> {
    const pending = this.starting.get(key);

    if (pending) {
      return pending;
    }

    const started = start()
      .then(shell => this.add(owner, shell, key))
      .finally(() => this.starting.delete(key));

    this.starting.set(key, started);

    return started;
  }

  /** Registers a started shell, its output read from now on: shown to the client, kept for the next. */
  private add(owner: string, shell: TerminalShell, key: string | null): string {
    const id = randomUUID();

    const keeping =
      key === null
        ? null
        : {
            key,
            scrollback: new TerminalScrollback(TerminalSessions.ScrollbackBytes),
            idleTimeout: setTimeout(() => {
              logger.info("Terminal idle, closing it", { terminal: id, user: owner });
              void this.end(id);
            }, TerminalSessions.KeptIdleMs),
          };

    const session: TerminalSession = { owner, shell, attachment: null, keeping };

    this.sessions.set(id, session);

    if (key !== null) {
      this.kept.set(key, id);
    }

    logger.info("Terminal opened", { terminal: id, user: owner, ...shell.target });

    shell.stream.on("data", (chunk: Buffer | string) => this.show(session, chunk));
    shell.stream.on("error", error => logger.warn("A terminal stream failed", { error, terminal: id }));
    // The shell exited, or its connection dropped.
    shell.stream.on("end", () => void this.end(id));
    shell.stream.on("close", () => void this.end(id));

    return id;
  }

  /** Writes the shell's output to the client, held back while it reads slower than the shell writes. */
  private show(session: TerminalSession, chunk: Buffer | string): void {
    if (session.keeping) {
      session.keeping.idleTimeout.refresh();
      session.keeping.scrollback.append(Buffer.from(chunk));
    }

    const output = session.attachment?.output;

    if (output && !output.write(chunk) && !session.shell.stream.isPaused()) {
      session.shell.stream.pause();
      output.once("drain", () => session.shell.stream.resume());
    }
  }

  /** Streams the session to a new client, replacing the one reading it, if any. */
  private connect(id: string, owner: string, signal: AbortSignal): OpenedTerminal {
    const session = this.session(id, owner);
    const output = new PassThrough();
    const heartbeat = setInterval(() => output.write(TerminalSessions.Heartbeat), TerminalSessions.HeartbeatMs);
    const attachment = { output, heartbeat };

    if (session.attachment) {
      session.attachment.output.write(TerminalSessions.TakenOver);
      TerminalSessions.release(session.attachment);
      // The previous client may have held the shell back: its output, ended, will never drain.
      session.shell.stream.resume();
    }

    const replayed = session.keeping?.scrollback.contents() ?? Buffer.alloc(0);

    if (replayed.length > 0) {
      output.write(replayed);
    }

    session.attachment = attachment;
    // Also called when the client left while the shell started, which a plain listener would miss.
    addAbortListener(signal, () => void this.detach(id, attachment));

    return { id, output, replayedBytes: replayed.length };
  }

  /** The client left: a kept session waits for the next one, any other ends. */
  private async detach(id: string, attachment: Attachment): Promise<void> {
    const session = this.sessions.get(id);

    // Gone, or taken over by another client meanwhile.
    if (!session || session.attachment !== attachment) {
      return;
    }

    if (!session.keeping) {
      await this.end(id);

      return;
    }

    TerminalSessions.release(attachment);
    session.attachment = null;
    // No client holds the shell back anymore: its output keeps filling the scrollback.
    session.shell.stream.resume();
    logger.info("Terminal detached", { terminal: id, user: session.owner });
  }

  /** Forgets a session and ends its shell. Called by its client leaving, its owner, idleness, or the shell exiting. */
  private async end(id: string): Promise<void> {
    const session = this.sessions.get(id);

    if (!session) {
      return;
    }

    this.sessions.delete(id);

    if (session.attachment) {
      TerminalSessions.release(session.attachment);
    }

    if (session.keeping) {
      clearTimeout(session.keeping.idleTimeout);
      this.kept.delete(session.keeping.key);
    }

    session.shell.stream.destroy();
    logger.info("Terminal closed", { terminal: id, user: session.owner });

    try {
      await session.shell.end();
    } catch (error) {
      logger.warn("Could not end a terminal's shell", { error, terminal: id, ...session.shell.target });
    }
  }

  /** Ends a client's output: what was written before still reaches it. */
  private static release(attachment: Attachment): void {
    clearInterval(attachment.heartbeat);
    attachment.output.end();
  }
}
