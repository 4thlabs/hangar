import { randomUUID } from "node:crypto";
import type Dockerode from "dockerode";
import type { TerminalShell, TerminalSize } from "#libs/terminals";
import type { ComposeContainerSource } from "./compose.ts";

/** The slice of `Docker` this class needs: a container, scoped to its project. */
export interface ProjectContainers {
  projectContainer(project: string, containerId: string): Promise<ComposeContainerSource>;
}

/** The container a shell opens in, and the project it must belong to. */
export type ContainerShellTarget = { project: string; containerId: string };

/**
 * Interactive shells in the apps' containers, handed to `TerminalSessions`: an exec with a TTY, whose
 * processes are hung up when the session ends.
 *
 * No `server-only` guard: see AGENTS.md § server-only.
 */
export class ContainerShells {
  /** Bash when the image has it, `sh` otherwise. */
  private static readonly Shell = ["/bin/sh", "-c", "command -v bash >/dev/null && exec bash || exec sh"];

  /** Marks every process of a shell, its children included, so {@link kill} can find them. */
  private static readonly Marker = "HANGAR_TERMINAL";

  /**
   * Hangs up every process of the container whose environment carries the marker set to `$1`. Needs only
   * `sh` and `cat`, which the shell already required.
   */
  private static readonly KillScript = `for process in /proc/[0-9]*; do
  case "$(cat "$process/environ" 2>/dev/null)" in
    *"${ContainerShells.Marker}=$1"*) kill -HUP "\${process#/proc/}" 2>/dev/null ;;
  esac
done`;

  private readonly docker: Dockerode;

  private readonly containers: ProjectContainers;

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
   * @throws {DockerNotFoundError} if the container is missing or belongs to another project
   */
  async open({ project, containerId }: ContainerShellTarget, size: TerminalSize): Promise<TerminalShell> {
    const { info } = await this.containers.projectContainer(project, containerId);
    const marker = randomUUID();
    const container = this.docker.getContainer(info.Id);

    const exec = await container.exec({
      Cmd: ContainerShells.Shell,
      Env: ["TERM=xterm-256color", `${ContainerShells.Marker}=${marker}`],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      ConsoleSize: [size.rows, size.cols],
    });

    const stream = await exec.start({ hijack: true, stdin: true, Tty: true });

    return {
      stream,
      target: { project, container: info.Id },
      resize: async ({ cols, rows }) => {
        await exec.resize({ h: rows, w: cols });
      },
      // A container that stopped meanwhile fails this: nothing is left to end, and the sessions log it.
      end: () => this.kill(container, marker),
    };
  }

  /**
   * Hangs up a shell and what it started. Closing the hijacked connection is not enough: Docker keeps the
   * TTY open, so the shell, and a `vi` it runs, would live on in the container.
   */
  private async kill(container: Dockerode.Container, marker: string): Promise<void> {
    const exec = await container.exec({ Cmd: ["/bin/sh", "-c", ContainerShells.KillScript, "sh", marker] });

    await exec.start({ Detach: true });
  }
}
