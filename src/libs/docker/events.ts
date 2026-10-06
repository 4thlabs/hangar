import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import type Dockerode from "dockerode";
import { logger } from "#libs/logs";
import { ComposeProjects } from "./compose.ts";

/**
 * What a daemon event can make stale: the Compose containers, the local image list, or the
 * host-wide overview. Internal to the library: callers ask `Docker.settle` instead.
 */
export type DockerChange = "containers" | "images" | "overview";

/** Every {@link DockerChange}, for a (re)connection that cannot tell which one happened. */
const DockerChanges: readonly DockerChange[] = ["containers", "images", "overview"];

/** The fields of a daemon event this class reads; the client hands them back untyped. */
type DockerEvent = {
  Type?: string;
  Actor?: { Attributes?: Record<string, string> };
};

/**
 * Follows the daemon's event stream and reports what each event made stale, whoever caused it.
 * Batched per {@link DockerChange}: the first event opens a window the rest join, so a steady
 * trickle cannot postpone the reload the way a debounce would. Owned by `Docker`, which starts it
 * from `Docker.follow`; not part of the library's barrel.
 *
 * No `server-only` guard: see AGENTS.md § server-only.
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
  private static readonly BatchWindowMs: Record<DockerChange, number> = {
    containers: 250,
    images: 250,
    overview: 2_000,
  };

  /** The first pause before reconnecting, doubled on every failure up to {@link MaxRetryDelayMs}. */
  private static readonly FirstRetryDelayMs = 1_000;

  /** The longest pause between two reconnection attempts. */
  private static readonly MaxRetryDelayMs = 30_000;

  private readonly docker: Dockerode;

  /** Told what went stale, once per batch. */
  private readonly onChange: (change: DockerChange) => void;

  /** The open batches, by what they will report. */
  private readonly batches = new Map<DockerChange, NodeJS.Timeout>();

  /** Set while following; aborting it tears the stream down. */
  private controller: AbortController | undefined;

  /**
   * @param docker An Engine API client; injected so the composition root owns the connection
   * @param onChange Called with what went stale; `Docker` reloads the matching snapshot
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
      case "container": {
        const isComposeContainer = Boolean(event.Actor?.Attributes?.[ComposeProjects.Label.project]);

        if (isComposeContainer) {
          return ["containers", "overview"];
        }

        return ["overview"];
      }

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
    if (this.controller) {
      return;
    }

    this.controller = new AbortController();
    void this.follow(this.controller.signal);
  }

  /**
   * Stops following, and drops the batches still open.
   */
  stop() {
    this.controller?.abort();
    this.controller = undefined;

    for (const timer of this.batches.values()) {
      clearTimeout(timer);
    }

    this.batches.clear();
  }

  /**
   * The connection loop. Every (re)connection reports everything as stale: whatever happened while
   * nothing was listening went by unseen, and before the first one nothing was listening at all.
   */
  private async follow(signal: AbortSignal) {
    let retryDelayMs = DockerEvents.FirstRetryDelayMs;

    while (!signal.aborted) {
      try {
        // A fresh object every time: the client deletes `abortSignal` from the options it is given.
        const stream = await this.docker.getEvents({ filters: DockerEvents.Filters, abortSignal: signal });

        logger.info("Following the Docker daemon's events");
        retryDelayMs = DockerEvents.FirstRetryDelayMs;
        this.scheduleAll();
        await this.readLines(stream, signal);

        if (!signal.aborted) {
          logger.warn("The Docker event stream ended, reconnecting");
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }

        logger.warn("The Docker event stream failed, reconnecting", { error });
      }

      await this.pauseBeforeReconnecting(retryDelayMs, signal);
      retryDelayMs = Math.min(retryDelayMs * 2, DockerEvents.MaxRetryDelayMs);
    }
  }

  /**
   * Batches what each line of the stream made stale, until the stream ends or `signal` aborts.
   * One JSON object per line; a line is only parsed once whole, wherever the chunks split it.
   */
  private async readLines(stream: NodeJS.ReadableStream, signal: AbortSignal) {
    const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

    for await (const line of lines) {
      // Lines already buffered when `stop` aborted the request must not open new batches.
      if (signal.aborted) {
        return;
      }

      this.readLine(line);
    }
  }

  /**
   * Batches what one line of the stream made stale. A line that is not an event is logged and skipped.
   */
  private readLine(line: string) {
    if (!line.trim()) {
      return;
    }

    let event: DockerEvent;

    try {
      event = JSON.parse(line) as DockerEvent;
    } catch (error) {
      logger.warn("Could not read a Docker event", { error });

      return;
    }

    for (const change of DockerEvents.changesOf(event)) {
      this.schedule(change);
    }
  }

  /**
   * Waits before the next connection attempt, or less once `signal` aborts.
   */
  private async pauseBeforeReconnecting(delayMs: number, signal: AbortSignal) {
    try {
      await sleep(delayMs, undefined, { signal });
    } catch {
      // `sleep` only rejects when `signal` aborts, and stopping is not a failure: the loop exits on its own.
    }
  }

  /**
   * Opens a batch for every {@link DockerChange}.
   */
  private scheduleAll() {
    for (const change of DockerChanges) {
      this.schedule(change);
    }
  }

  /**
   * Opens a batch for `change`, or joins the one already open.
   */
  private schedule(change: DockerChange) {
    if (this.batches.has(change)) {
      return;
    }

    const timer = setTimeout(() => {
      this.batches.delete(change);
      this.onChange(change);
    }, DockerEvents.BatchWindowMs[change]);

    // Never a reason to hold the process open: a batch only refreshes a cache.
    timer.unref();
    this.batches.set(change, timer);
  }
}
