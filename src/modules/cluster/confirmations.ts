import type { SwarmCluster, SwarmNode, SwarmNodeAction } from "#libs/docker";
import { plural } from "#modules/apps/format.ts";
import { nodeActionLabel } from "#modules/cluster/status.ts";

type ManagerCluster = Extract<SwarmCluster, { state: "manager" }>;

/** What the confirmation of a node action says, before anything is sent to the daemon. */
export type NodeActionConfirmation = { title: string; description: string; destructive: boolean };

/** The fault tolerance once `action` is done: only a promotion or a demotion moves it. */
function toleranceAfter(cluster: ManagerCluster, action: SwarmNodeAction) {
  if (action === "promote" || action === "demote") {
    return cluster.faultToleranceAfter[action];
  }

  return cluster.faultTolerance;
}

/** Where a drained node's tasks go, French agreeing in number. */
function drainedTasks(tasks: number, hostname: string) {
  if (tasks === 0) {
    return `Aucune tâche ne tourne sur ${hostname}.`;
  }

  if (tasks === 1) {
    return `La tâche de ${hostname} sera replacée sur un autre nœud.`;
  }

  return `Les ${tasks} tâches de ${hostname} seront replacées sur les autres nœuds.`;
}

/** What `action` does to `node`, in a sentence. */
function consequence(node: SwarmNode, action: SwarmNodeAction) {
  const tasks = node.stacks.reduce((total, stack) => total + stack.tasks, 0);

  switch (action) {
    case "promote":
      return `${node.hostname} rejoindra les managers et participera au quorum.`;
    case "demote":
      return `${node.hostname} redeviendra worker.`;
    case "drain":
      return `${drainedTasks(tasks, node.hostname)} Aucune nouvelle tâche n'y sera planifiée.`;
    case "activate":
      return `${node.hostname} pourra de nouveau recevoir des tâches.`;
    case "remove":
      return `${node.hostname} sera retiré du cluster. S'il redémarre, il devra le rejoindre à nouveau avec un token.`;
  }
}

/**
 * The confirmation for a node action: what it does, and how many manager failures the cluster
 * tolerates afterwards. Demoting the node Hangar runs on also costs Hangar its view of the cluster.
 */
export function nodeActionConfirmation(
  cluster: ManagerCluster,
  node: SwarmNode,
  action: SwarmNodeAction,
): NodeActionConfirmation {
  const tolerance = `Le cluster tolérera ensuite ${plural(toleranceAfter(cluster, action), "panne")} de manager.`;

  const losesView =
    action === "demote" && node.id === cluster.currentNodeId
      ? " Hangar tourne sur ce nœud : devenu worker, il ne verra plus le cluster."
      : "";

  return {
    title: `${nodeActionLabel[action]} ${node.hostname} ?`,
    description: `${consequence(node, action)} ${tolerance}${losesView}`,
    destructive: action === "remove" || action === "demote",
  };
}
