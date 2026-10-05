import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import type Dockerode from "dockerode";
import { logger } from "#libs/logs";
import { ComposeProjects } from "./compose.ts";
import { DockerChanges, type DockerChange } from "./docker.ts";

/** The fields of a daemon event this class reads; the client hands them back untyped. */
type DockerEvent = {
  Type?: string;
  Actor?: { Attributes?: Record<string, string> };
};

/**
 * Follows the daemon's event stream and reports what each event made stale, so the cached reads
 * move when the daemon does rather than when a caller remembers to say so.
 *
 * Every path that changes a container is covered by construction — a Compose command from the
 * web, the CLI or a Sidequest job (another process, out of reach of the web server's cache), a
 * `docker compose` typed on the host, a container that crashed or restarted on its own.
 *
 * Events are batched per {@link DockerChange}: a `compose up` emits dozens of them, and they cost
 * one reload, not one each. The first event of a batch opens a window and the rest join it, so a
 * steady trickle cannot postpone the reload indefinitely the way a debounce would.
 *
 * No `server-only` guard, for the same reason as `Docker`: see `./server/server.ts`.
 */
export class DockerEvents {
  /**
   * Only what moves a cached read, which keeps out the noisy actions: a healthcheck runs as an
   * exec every interval, and `exec_*`, `attach` or `top` change nothing that is cached.
   * `health_status` is matched by prefix on the daemon's side, so it covers `health_status: healthy`.
   */
  private static readonly Filters = {
    type: ["container" as const, "image" as const, "volume" as const],
    event: [
      // Containers
      "create",
      "start",
      "restart",
      "stop",
      "die",
      "kill",
      "pause",
      "unpause",
      "destroy",
      "rename",
      "update",
      "health_status",
      // Images
      "pull",
      "tag",
      "untag",
      "delete",
      "import",
      "load",
      // Containers, images and volumes
      "prune",
    ],
  };

  /**
   * How long a batch stays open. `df`, behind the overview, is the slowest call the daemon has, so
   * it waits longer and catches a whole `compose up` in one go.
   */
  private static readonly Batch: Record<DockerChange, number> = { containers: 250, images: 250, overview: 2_000 };

  /** The first pause before reconnecting, doubled on every failure up to {@link MaxRetry}. */
  private static readonly Retry = 1_000;

  /** The longest pause between two reconnection attempts. */
  private static readonly MaxRetry = 30_000;

  /** The Engine API client. */
  private readonly docker: Dockerode;

  /** Told what went stale, once per batch. */
  private readonly onChange: (change: DockerChange) => void;

  /** The open batches, by what they will report. */
  private readonly batches = new Map<DockerChange, NodeJS.Timeout>();

  /** Set while following; aborting it tears the stream down. */
  private controller: AbortController | undefined;

  /**
   * @param docker An Engine API client; injected so the composition root owns the connection
   * @param onChange Called with what went stale, `docker.refresh` in production
   */
  constructor(docker: Dockerode, onChange: (change: DockerChange) => void) {
    this.docker = docker;
    this.onChange = onChange;
  }

  /**
   * What one event made stale.
   *
   * Every container counts for the overview, which reports the whole host; only a Compose one
   * counts for the containers, which never hold the others.
   */
  static changesOf(event: DockerEvent): DockerChange[] {
    switch (event.Type) {
      case "container":
        return event.Actor?.Attributes?.[ComposeProjects.Label.project] ? ["containers", "overview"] : ["overview"];
      case "image":
        return ["images", "overview"];
      case "volume":
        return ["overview"];
      default:
        return [];
    }
  }

  /**
   * Starts following the stream, and keeps reconnecting until {@link stop}. Returns at once: the
   * stream runs behind the caller.
   */
  start() {
    if (this.controller) return;

    this.controller = new AbortController();
    void this.follow(this.controller.signal);
  }

  /**
   * Stops following, and drops the batches still open.
   */
  stop() {
    this.controller?.abort();
    this.controller = undefined;

    for (const timer of this.batches.values()) clearTimeout(timer);
    this.batches.clear();
  }

  /**
   * The connection loop. Every (re)connection reports everything as stale: whatever happened while
   * nothing was listening went by unseen, and before the first one nothing was listening at all.
   */
  private async follow(signal: AbortSignal) {
    let retry = DockerEvents.Retry;

    while (!signal.aborted) {
      try {
        // A fresh object every time: the client deletes `abortSignal` from the options it is given.
        const stream = await this.docker.getEvents({ filters: DockerEvents.Filters, abortSignal: signal });

        logger.info("Following the Docker daemon's events");
        retry = DockerEvents.Retry;
        for (const change of DockerChanges) this.schedule(change);

        // One JSON object per line; a line is only parsed once whole, wherever the chunks split it.
        for await (const line of createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })) {
          // Lines already buffered when `stop` aborted the request must not open new batches.
          if (signal.aborted) break;

          this.receive(line);
        }

        if (!signal.aborted) logger.warn("The Docker event stream ended, reconnecting");
      } catch (error) {
        if (signal.aborted) return;

        logger.warn("The Docker event stream failed, reconnecting", { error });
      }

      await sleep(retry, undefined, { signal }).catch(() => undefined);
      retry = Math.min(retry * 2, DockerEvents.MaxRetry);
    }
  }

  /**
   * Batches what one line of the stream made stale.
   */
  private receive(line: string) {
    if (!line.trim()) return;

    try {
      for (const change of DockerEvents.changesOf(JSON.parse(line) as DockerEvent)) this.schedule(change);
    } catch (error) {
      logger.warn("Could not read a Docker event", { error });
    }
  }

  /**
   * Opens a batch for `change`, or joins the one already open.
   */
  private schedule(change: DockerChange) {
    if (this.batches.has(change)) return;

    const timer = setTimeout(() => {
      this.batches.delete(change);
      this.onChange(change);
    }, DockerEvents.Batch[change]);

    // Never a reason to hold the process open: a batch only refreshes a cache.
    timer.unref();
    this.batches.set(change, timer);
  }
}
