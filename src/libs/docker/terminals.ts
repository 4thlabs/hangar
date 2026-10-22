import { randomUUID } from "node:crypto";
import { addAbortListener } from "node:events";
import { PassThrough, type Duplex, type Readable } from "node:stream";
import type Dockerode from "dockerode";
import { logger } from "#libs/logs";
import { DockerNotFoundError, type ComposeContainerSource } from "./compose.ts";

/** A terminal's size in character cells, as xterm measures it. */
export type TerminalSize = { cols: number; rows: number };

/** The slice of `Docker` this class needs: a container, scoped to its project. */
export interface ProjectContainers {
  projectContainer(project: string, containerId: string): Promise<ComposeContainerSource>;
}

/** What {@link ContainerTerminals.open} hands the route: the id the input is sent to, and the TTY's output. */
export type OpenedTerminal = { id: string; output: Readable };

/** Who may open a terminal, and in which container. */
export type TerminalTarget = { owner: string; project: string; containerId: string };

type TerminalSession = {
  owner: string;
  container: Dockerode.Container;
  exec: Dockerode.Exec;
  stream: Duplex;
  output: PassThrough;
  heartbeat: NodeJS.Timeout;
};

/**
 * Interactive shells in containers: a TTY whose output streams to the request that opened it, and whose
 * input and resizes arrive in requests of their own, by session id. In memory: Hangar is one process.
 *
 * No `server-only` guard: see AGENTS.md § server-only.
 */
export class ContainerTerminals {
  /** Bash when the image has it, `sh` otherwise. */
  private static readonly Shell = ["/bin/sh", "-c", "command -v bash >/dev/null && exec bash || exec sh"];

  /**
   * How often an idle session sends {@link Heartbeat}: under the idle timeout of the usual proxies (60 s for
   * nginx and Traefik), which would end the response, and with it the shell.
   */
  private static readonly HeartbeatMs = 30_000;

  /** A byte the terminal ignores (NUL), so the stream never goes silent. */
  private static readonly Heartbeat = "\0";

  /** Marks every process of a session, its children included, so {@link kill} can find them. */
  private static readonly Marker = "HANGAR_TERMINAL";

  /**
   * Hangs up every process of the container whose environment carries the marker set to `$1`. Needs only
   * `sh` and `cat`, which the shell already required.
   */
  private static readonly KillScript = `for process in /proc/[0-9]*; do
  case "$(cat "$process/environ" 2>/dev/null)" in
    *"${ContainerTerminals.Marker}=$1"*) kill -HUP "\${process#/proc/}" 2>/dev/null ;;
  esac
done`;

  private readonly docker: Dockerode;

  private readonly containers: ProjectContainers;

  private readonly sessions = new Map<string, TerminalSession>();

  /**
   * @param docker An Engine API client; injected so the composition root owns the connection
   * @param containers The project-scoped container lookup, satisfied by `Docker`
   */
  constructor(docker: Dockerode, containers: ProjectContainers) {
    this.docker = docker;
    this.containers = containers;
  }

  /**
   * Starts a shell in a container of `project`, sized to the client's terminal.
   * @param signal Aborted when the client stops reading; closes the session
   * @throws {DockerNotFoundError} if the container is missing or belongs to another project
   */
  async open(
    { owner, project, containerId }: TerminalTarget,
    size: TerminalSize,
    signal: AbortSignal,
  ): Promise<OpenedTerminal> {
    const { info } = await this.containers.projectContainer(project, containerId);
    const id = randomUUID();
    const container = this.docker.getContainer(info.Id);

    const exec = await container.exec({
      Cmd: ContainerTerminals.Shell,
      Env: ["TERM=xterm-256color", `${ContainerTerminals.Marker}=${id}`],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      ConsoleSize: [size.rows, size.cols],
    });

    const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
    const output = new PassThrough();

    const heartbeat = setInterval(() => output.write(ContainerTerminals.Heartbeat), ContainerTerminals.HeartbeatMs);

    this.sessions.set(id, { owner, container, exec, stream, output, heartbeat });
    logger.info("Terminal opened", { terminal: id, user: owner, project, container: info.Id });

    // A TTY is one stream: no stdout/stderr framing to demux, unlike the logs.
    stream.pipe(output);
    stream.on("error", error => logger.warn("A terminal stream failed", { error, terminal: id }));
    // The shell exited, or the daemon dropped the connection.
    stream.on("close", () => void this.close(id));

    // Also called when the client left while the exec started, which a plain listener would miss.
    addAbortListener(signal, () => void this.close(id));

    return { id, output };
  }

  /**
   * Types into a session's shell.
   * @throws {DockerNotFoundError} if the session is gone or belongs to someone else
   */
  write(id: string, owner: string, input: string): void {
    this.session(id, owner).stream.write(input);
  }

  /**
   * Resizes a session's TTY, so full-screen programs redraw to the client's terminal.
   * @throws {DockerNotFoundError} if the session is gone or belongs to someone else
   */
  async resize(id: string, owner: string, size: TerminalSize): Promise<void> {
    await this.session(id, owner).exec.resize({ h: size.rows, w: size.cols });
  }

  /** A session of `owner`; someone else's reads as missing, so ids cannot be probed. */
  private session(id: string, owner: string): TerminalSession {
    const session = this.sessions.get(id);

    if (!session || session.owner !== owner) {
      throw new DockerNotFoundError(`terminal ${id}`);
    }

    return session;
  }

  /** Forgets a session and ends its processes. Called by both the client leaving and the shell exiting. */
  private async close(id: string): Promise<void> {
    const session = this.sessions.get(id);

    if (!session) {
      return;
    }

    this.sessions.delete(id);
    clearInterval(session.heartbeat);
    session.stream.destroy();
    session.output.end();
    logger.info("Terminal closed", { terminal: id, user: session.owner });

    try {
      await this.kill(session.container, id);
    } catch (error) {
      // Typically a container that stopped meanwhile: nothing is left to end.
      logger.warn("Could not end a terminal's processes", { error, terminal: id });
    }
  }

  /**
   * Hangs up a session's shell and what it started. Closing the hijacked connection is not enough: Docker
   * keeps the TTY open, so the shell, and a `vi` it runs, would live on in the container.
   */
  private async kill(container: Dockerode.Container, id: string): Promise<void> {
    const exec = await container.exec({ Cmd: ["/bin/sh", "-c", ContainerTerminals.KillScript, "sh", id] });

    await exec.start({ Detach: true });
  }
}
