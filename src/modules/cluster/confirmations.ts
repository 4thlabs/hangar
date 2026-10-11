import type { SwarmManagerView, SwarmNode, SwarmNodeAction } from "#libs/docker";
import { SwarmRules } from "#libs/docker/swarm-rules";
import { plural } from "#modules/apps/format.ts";
import { ClusterLabels } from "#modules/cluster/labels.ts";

/** What the confirmation of a node action says, before anything is sent to the daemon. */
export type NodeActionConfirmation = { title: string; description: string; destructive: boolean };

/** The confirmations of the node actions, which state what each one costs. */
export class NodeActionConfirmations {
  /** How each action moves the number of managers, which the fault tolerance follows. */
  private static readonly ManagerDelta: Record<SwarmNodeAction, number> = {
    promote: 1,
    demote: -1,
    drain: 0,
    activate: 0,
    remove: 0,
  };

  /**
   * The confirmation for a node action: what it does, and how many manager failures the cluster
   * tolerates afterwards. Demoting the node Hangar runs on also costs Hangar its view of the cluster.
   */
  static create(cluster: SwarmManagerView, node: SwarmNode, action: SwarmNodeAction): NodeActionConfirmation {
    const toleranceAfter = SwarmRules.faultTolerance(cluster.managers + NodeActionConfirmations.ManagerDelta[action]);
    const tolerance = `Le cluster tolérera ensuite ${plural(toleranceAfter, "panne")} de manager.`;

    const losesView =
      action === "demote" && node.id === cluster.currentNodeId
        ? " Hangar tourne sur ce nœud : devenu worker, il ne verra plus le cluster."
        : "";

    return {
      title: `${ClusterLabels.NodeAction[action]} ${node.hostname} ?`,
      description: `${NodeActionConfirmations.consequence(node, action)} ${tolerance}${losesView}`,
      destructive: action === "remove" || action === "demote",
    };
  }

  /** What `action` does to `node`, in a sentence. */
  private static consequence(node: SwarmNode, action: SwarmNodeAction) {
    switch (action) {
      case "promote":
        return `${node.hostname} rejoindra les managers et participera au quorum.`;
      case "demote":
        return `${node.hostname} redeviendra worker.`;
      case "drain":
        return `${NodeActionConfirmations.drainedTasks(node)} Aucune nouvelle tâche n'y sera planifiée.`;
      case "activate":
        return `${node.hostname} pourra de nouveau recevoir des tâches.`;
      case "remove":
        return `${node.hostname} sera retiré du cluster. S'il redémarre, il devra le rejoindre à nouveau avec un token.`;
    }
  }

  /** Where a drained node's tasks go, French agreeing in number. */
  private static drainedTasks(node: SwarmNode) {
    const { tasks } = node;

    if (tasks === 0) {
      return `Aucune tâche ne tourne sur ${node.hostname}.`;
    }

    if (tasks === 1) {
      return `La tâche de ${node.hostname} sera replacée sur un autre nœud.`;
    }

    return `Les ${tasks} tâches de ${node.hostname} seront replacées sur les autres nœuds.`;
  }
}
