import type { SwarmNodeAvailability, SwarmNodeRole, SwarmNodeStatus } from "../swarm.ts";

/** What Hangar can change on a node of the swarm. */
export type SwarmNodeAction = "promote" | "demote" | "drain" | "activate" | "remove";

/** Why an action does not apply to a node; see {@link SwarmRules.nodeRefusal}. */
export type SwarmNodeRefusal =
  "already-done" | "last-manager" | "not-raft-member" | "manager-not-removable" | "node-not-down";

/** The fields of a node that decide which actions apply to it. */
export type SwarmNodeState = {
  role: SwarmNodeRole;
  status: SwarmNodeStatus;
  availability: SwarmNodeAvailability;
  /**
   * Whether it sits in the managers' Raft group. A promotion only records the wish: a node promoted
   * while out of reach is a manager in name only until it joins, and the daemon then refuses to demote it.
   */
  isRaftMember: boolean;
};

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
   * A node label key a placement constraint can name: swarmkit only parses `node.labels.<key>` made of
   * letters, digits, `-`, `_` and `.`. The daemon itself would store any key, unusable as it would be.
   */
  private static readonly LabelKey = /^[a-z0-9][\w.-]{0,127}$/i;

  /** A node label value: one line, of reasonable length. */
  private static readonly LabelValue = /^[^\p{Cc}]{0,255}$/u;

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

        // Swarmkit demotes by leaving Raft, which a manager in name only cannot do; it can be removed.
        if (!node.isRaftMember) {
          return "not-raft-member";
        }

        return managers <= 1 ? "last-manager" : null;
      case "drain":
        return node.availability === "drain" ? "already-done" : null;
      case "activate":
        return node.availability === "active" ? "already-done" : null;
      case "remove":
        // The daemon refuses to remove a member of the Raft group: it must be demoted first.
        if (node.isRaftMember) {
          return "manager-not-removable";
        }

        // Without `force`, the daemon only refuses a ready node; one it lost track of goes too.
        return node.status === "ready" ? "node-not-down" : null;
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

  /** Whether `key` can name a node label, and a placement constraint then match it. */
  static isLabelKey(key: string) {
    return SwarmRules.LabelKey.test(key);
  }

  /** Whether `value` can be a node label's value; empty is allowed, as `docker node update` allows it. */
  static isLabelValue(value: string) {
    return SwarmRules.LabelValue.test(value);
  }

  /**
   * How many managers can fail before the rest no longer form a majority, and the cluster its quorum.
   * @param managers How many managers the cluster has
   */
  static faultTolerance(managers: number) {
    return Math.max(0, Math.floor((managers - 1) / 2));
  }
}
