import type { SwarmNodeAvailability, SwarmNodeRole, SwarmNodeStatus } from "../swarm.ts";

/** What Hangar can change on a node of the swarm. */
export type SwarmNodeAction = "promote" | "demote" | "drain" | "activate" | "remove";

/** Why an action does not apply to a node; see {@link SwarmRules.nodeRefusal}. */
export type SwarmNodeRefusal = "already-done" | "last-manager" | "manager-not-removable" | "node-not-down";

/** The fields of a node that decide which actions apply to it. */
export type SwarmNodeState = { role: SwarmNodeRole; status: SwarmNodeStatus; availability: SwarmNodeAvailability };

/**
 * The rules of the swarm the page shares with the library. Client-safe: no Node module, no client,
 * so a client component can apply them to what the server read.
 */
export class SwarmRules {
  /** Every action Hangar can take on a node, in the order the page offers them. */
  static readonly NodeActions: readonly SwarmNodeAction[] = ["promote", "demote", "drain", "activate", "remove"];

  /**
   * How long a read of the swarm is reused. Short, because Docker emits no event for a task: only time
   * moves the task counts, so the page reloads at the same pace.
   */
  static readonly RefreshMs = 10_000;

  /**
   * Why `action` cannot run on `node`, or `null` when it can. One rule for both the buttons the page
   * offers and the check before the call, so a stale page cannot do what the buttons would not.
   * @param managers How many managers the cluster has, the node included if it is one
   */
  static nodeRefusal(action: SwarmNodeAction, node: SwarmNodeState, managers: number): SwarmNodeRefusal | null {
    const isManager = node.role !== "worker";

    switch (action) {
      case "promote":
        return isManager ? "already-done" : null;
      case "demote":
        if (!isManager) {
          return "already-done";
        }

        return managers <= 1 ? "last-manager" : null;
      case "drain":
        return node.availability === "drain" ? "already-done" : null;
      case "activate":
        return node.availability === "active" ? "already-done" : null;
      case "remove":
        // The daemon refuses to remove a manager from the Raft group: it must be demoted first.
        if (isManager) {
          return "manager-not-removable";
        }

        return node.status === "down" ? null : "node-not-down";
    }
  }

  /** The actions that apply to `node`, in page order. */
  static nodeActions(node: SwarmNodeState, managers: number): SwarmNodeAction[] {
    return SwarmRules.NodeActions.filter(action => SwarmRules.nodeRefusal(action, node, managers) === null);
  }

  /** Whether `value` names one of the {@link NodeActions}, as a request spells it. */
  static isNodeAction(value: string): value is SwarmNodeAction {
    return (SwarmRules.NodeActions as readonly string[]).includes(value);
  }

  /**
   * How many managers can fail before the rest no longer form a majority, and the cluster its quorum.
   * @param managers How many managers the cluster has
   */
  static faultTolerance(managers: number) {
    return Math.max(0, Math.floor((managers - 1) / 2));
  }
}
