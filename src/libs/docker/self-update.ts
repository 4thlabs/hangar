import { dirname } from "node:path";
import type Dockerode from "dockerode";
import { ComposeProjects } from "./compose.ts";

/** The Compose project and service Hangar runs as, which the update recreates. */
export type SelfUpdateTarget = {
  /** The reference Hangar was started from, such as `ghcr.io/4thlabs/hangar:latest`: what the update pulls. */
  image: string;
  project: string;
  service: string;
  /** Host paths, as Compose recorded them when it created the container. */
  workingDir: string;
  configFiles: string[];
};

/** Why Hangar cannot update itself, as the settings page words it in the reader's language. */
export type SelfUpdateUnavailableReason = "noContainer" | "noCompose" | "inProgress";

/** Why Hangar cannot update itself where it runs. Its message is for the logs; the UI words its `reason`. */
export class SelfUpdateUnavailableError extends Error {
  readonly reason: SelfUpdateUnavailableReason;

  constructor(reason: SelfUpdateUnavailableReason, message: string) {
    super(message);
    this.name = "SelfUpdateUnavailableError";
    this.reason = reason;
  }
}

/**
 * Updates the container Hangar runs in: pulls its image and recreates it with Compose.
 *
 * Compose cannot run from inside Hangar for this: recreating the container stops it, and the command
 * with it, before the new one is started. A relay container runs the commands instead, from the
 * current Hangar image, which carries the Docker CLI and Compose. It outlives the container it
 * replaces, and stays after it ends so `docker logs` can tell why an update did not go through.
 */
export class DockerSelfUpdate {
  /** The relay's name: one at a time, and easy to find for `docker logs`. */
  static readonly RelayName = "hangar-self-update";

  /** The labels Compose sets besides the ones {@link ComposeProjects} reads, telling where the project lives. */
  static readonly Label = {
    workingDir: "com.docker.compose.project.working_dir",
    configFiles: "com.docker.compose.project.config_files",
  } as const;

  static readonly SocketPath = "/var/run/docker.sock";

  /**
   * Pulls first, so a failed pull leaves Hangar running as it was. `--no-deps` recreates Hangar
   * alone, never the other services of its project. The arguments arrive as positional parameters,
   * so no path or name is ever parsed by the shell.
   */
  static readonly Script = 'docker compose "$@" pull "$SERVICE" && docker compose "$@" up -d --no-deps "$SERVICE"';

  private readonly docker: Dockerode;

  /** The container Hangar runs in: Docker sets a container's hostname to its short id. */
  private readonly containerId: string;

  constructor(docker: Dockerode, containerId: string) {
    this.docker = docker;
    this.containerId = containerId;
  }

  /**
   * What an update would recreate.
   * @throws {SelfUpdateUnavailableError} When Hangar does not run in a container Compose created
   */
  async target(): Promise<SelfUpdateTarget> {
    return DockerSelfUpdate.targetOf(await this.inspectSelf());
  }

  /**
   * Starts the relay, and returns as soon as it runs: the update stops this process soon after.
   * @throws {SelfUpdateUnavailableError} When Hangar cannot update itself, or an update already runs
   */
  async start(): Promise<SelfUpdateTarget> {
    const self = await this.inspectSelf();
    const target = DockerSelfUpdate.targetOf(self);

    await this.removeFinishedRelay();

    const socket = self.Mounts.find(mount => mount.Destination === DockerSelfUpdate.SocketPath)?.Source;
    // The project's folders at their host paths, as the daemon resolves the compose files' relative
    // paths against those, and `${PWD}` from the relay's working directory.
    const folders = [...new Set([target.workingDir, ...target.configFiles.map(file => dirname(file))])];

    const projectArguments = [
      "-p",
      target.project,
      "--project-directory",
      target.workingDir,
      ...target.configFiles.flatMap(file => ["-f", file]),
    ];

    const relay = await this.docker.createContainer({
      name: DockerSelfUpdate.RelayName,
      // The image id, not the reference: the tag may already point at the new image.
      Image: self.Image,
      Entrypoint: ["sh", "-c", DockerSelfUpdate.Script, "sh", ...projectArguments],
      Cmd: [],
      Env: [`SERVICE=${target.service}`],
      WorkingDir: target.workingDir,
      HostConfig: {
        Binds: [
          `${socket ?? DockerSelfUpdate.SocketPath}:${DockerSelfUpdate.SocketPath}`,
          ...folders.map(folder => `${folder}:${folder}`),
        ],
      },
    });

    await relay.start();

    return target;
  }

  /** Hangar's own container, as the daemon describes it. */
  private async inspectSelf(): Promise<Dockerode.ContainerInspectInfo> {
    try {
      return await this.docker.getContainer(this.containerId).inspect();
    } catch (error) {
      // Outside a container, the hostname names no container. Any other failure is the daemon's.
      if ((error as { statusCode?: number }).statusCode === 404) {
        throw new SelfUpdateUnavailableError("noContainer", "Hangar does not run in a Docker container");
      }

      throw error;
    }
  }

  /** Where Compose says the container comes from, which only a container it created carries. */
  private static targetOf(container: Dockerode.ContainerInspectInfo): SelfUpdateTarget {
    const labels = container.Config.Labels ?? {};
    const project = labels[ComposeProjects.Label.project];
    const service = labels[ComposeProjects.Label.service];
    const workingDir = labels[DockerSelfUpdate.Label.workingDir];
    const configFiles = labels[DockerSelfUpdate.Label.configFiles];

    if (!project || !service || !workingDir || !configFiles) {
      throw new SelfUpdateUnavailableError("noCompose", "Hangar was not started with Docker Compose");
    }

    return { image: container.Config.Image, project, service, workingDir, configFiles: configFiles.split(",") };
  }

  /** Clears the previous relay out of the way of its name, unless it is still updating. */
  private async removeFinishedRelay() {
    const relay = this.docker.getContainer(DockerSelfUpdate.RelayName);

    // No relay yet is the usual case: a 404, nothing to clear.
    const previous = await relay.inspect().catch((error: { statusCode?: number }) => {
      if (error.statusCode === 404) {
        return null;
      }

      throw error;
    });

    if (!previous) {
      return;
    }

    if (previous.State.Running) {
      throw new SelfUpdateUnavailableError("inProgress", "A Hangar update is already running");
    }

    await relay.remove();
  }
}
