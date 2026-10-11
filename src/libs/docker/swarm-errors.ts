import type { SwarmNodeAction, SwarmNodeRefusal } from "./swarm-rules/index.ts";

/** Why Hangar turned a node action down before calling the daemon. */
export type SwarmRefusal = SwarmNodeRefusal | "unknown-node";

/** A node action Hangar turned down, before anything was sent to the daemon. */
export class SwarmRefusedError extends Error {
  readonly refusal: SwarmRefusal;

  constructor(refusal: SwarmRefusal, action: SwarmNodeAction, nodeId: string) {
    super(`Refused to ${action} swarm node ${nodeId}: ${refusal}`);
    this.name = "SwarmRefusedError";
    this.refusal = refusal;
  }
}

/**
 * A request the daemon answered with an error of its own, such as an address it cannot choose, a
 * rotated token or a quorum to keep. Its message is the daemon's, which says what to fix.
 */
export class SwarmDaemonError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "SwarmDaemonError";
    this.statusCode = statusCode;
  }

  /**
   * The daemon's own error for a failed Engine API call, or the call's error unchanged when the daemon
   * gave no message (a socket that cannot be reached, a timeout).
   */
  static from(error: unknown): unknown {
    const { statusCode, json } = (error ?? {}) as { statusCode?: number; json?: { message?: string } };

    if (statusCode === undefined || !json?.message) {
      return error;
    }

    return new SwarmDaemonError(statusCode, json.message);
  }
}
