import type { SwarmNodeAvailability, SwarmNodeRole, SwarmNodeStatus } from "./swarm.ts";

/** What Hangar can change on a node of the swarm. */
export type SwarmNodeAction = "promote" | "demote" | "drain" | "activate" | "remove";

/** Every {@link SwarmNodeAction}, in the order the page offers them. */
export const SwarmNodeActions: readonly SwarmNodeAction[] = ["promote", "demote", "drain", "activate", "remove"];

/** Why an action cannot run on a node; see {@link swarmNodeRefusal}. */
export type SwarmRefusal = "already-done" | "last-manager" | "manager-not-removable" | "node-not-down" | "unknown-node";

/** An action {@link swarmNodeRefusal} turned down, before anything was sent to the daemon. */
export class SwarmRefusedError extends Error {
  readonly refusal: SwarmRefusal;

  constructor(refusal: SwarmRefusal, action: SwarmNodeAction, nodeId: string) {
    super(`Refused to ${action} swarm node ${nodeId}: ${refusal}`);
    this.name = "SwarmRefusedError";
    this.refusal = refusal;
  }
}

/** The fields of a node that decide which actions apply to it. */
type NodeState = { role: SwarmNodeRole; status: SwarmNodeStatus; availability: SwarmNodeAvailability };

/**
 * Why `action` cannot run on `node`, or `null` when it can. One rule for both the buttons the page
 * offers and the check before the call, so a stale page cannot do what the buttons would not.
 * @param managers How many managers the cluster has, the node included if it is one
 */
export function swarmNodeRefusal(action: SwarmNodeAction, node: NodeState, managers: number): SwarmRefusal | null {
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
export function swarmNodeActions(node: NodeState, managers: number): SwarmNodeAction[] {
  return SwarmNodeActions.filter(action => swarmNodeRefusal(action, node, managers) === null);
}
