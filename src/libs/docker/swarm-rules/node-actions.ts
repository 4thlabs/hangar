import type { SwarmNodeAvailability, SwarmNodeRole, SwarmNodeStatus } from "../swarm.ts";

/** Every action Hangar can take on a node of the swarm, in the order the page offers them. */
export const SwarmNodeActions = ["promote", "demote", "drain", "activate", "remove"] as const;

/** What Hangar can change on a node of the swarm. */
export type SwarmNodeAction = (typeof SwarmNodeActions)[number];

/** Why an action does not apply to a node; see {@link swarmNodeRefusal}. */
export type SwarmNodeRefusal = "already-done" | "last-manager" | "manager-not-removable" | "node-not-down";

/** The fields of a node that decide which actions apply to it. */
export type SwarmNodeState = { role: SwarmNodeRole; status: SwarmNodeStatus; availability: SwarmNodeAvailability };

/**
 * Why `action` cannot run on `node`, or `null` when it can. One rule for both the buttons the page
 * offers and the check before the call, so a stale page cannot do what the buttons would not.
 * @param managers How many managers the cluster has, the node included if it is one
 */
export function swarmNodeRefusal(
  action: SwarmNodeAction,
  node: SwarmNodeState,
  managers: number,
): SwarmNodeRefusal | null {
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
export function swarmNodeActions(node: SwarmNodeState, managers: number): SwarmNodeAction[] {
  return SwarmNodeActions.filter(action => swarmNodeRefusal(action, node, managers) === null);
}
