import type { SwarmManagerView, SwarmNode, SwarmNodeAction } from "#libs/docker";
import { SwarmRules } from "#libs/docker/swarm-rules";
import type { Translate } from "#libs/i18n";
import type { ClusterMessages } from "#modules/cluster/messages.ts";

/** The words of /cluster, in the reader's language. */
type ClusterTranslate = Translate<typeof ClusterMessages.en>;

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
  static create(
    cluster: SwarmManagerView,
    node: SwarmNode,
    action: SwarmNodeAction,
    t: ClusterTranslate,
  ): NodeActionConfirmation {
    const toleranceAfter = SwarmRules.faultTolerance(cluster.managers + NodeActionConfirmations.ManagerDelta[action]);
    const tolerance = t("confirm.tolerance", { count: toleranceAfter });
    const losesView = action === "demote" && node.id === cluster.currentNodeId ? ` ${t("confirm.losesView")}` : "";

    return {
      title: t("confirm.title", { action: t(`nodeAction.${action}`), hostname: node.hostname }),
      description: `${NodeActionConfirmations.consequence(node, action, t)} ${tolerance}${losesView}`,
      destructive: action === "remove" || action === "demote",
    };
  }

  /** What `action` does to `node`, in a sentence. */
  private static consequence(node: SwarmNode, action: SwarmNodeAction, t: ClusterTranslate) {
    const { hostname } = node;

    switch (action) {
      case "promote":
        return t("confirm.promote", { hostname });
      case "demote":
        return t("confirm.demote", { hostname });
      case "drain":
        return t("confirm.drain", { tasks: NodeActionConfirmations.drainedTasks(node, t) });
      case "activate":
        return t("confirm.activate", { hostname });
      case "remove":
        return t("confirm.remove", { hostname });
    }
  }

  /** Where a drained node's tasks go, agreeing in number. */
  private static drainedTasks(node: SwarmNode, t: ClusterTranslate) {
    const { tasks, hostname } = node;

    if (tasks === 0) {
      return t("confirm.drainNone", { hostname });
    }

    if (tasks === 1) {
      return t("confirm.drainOne", { hostname });
    }

    return t("confirm.drainMany", { hostname, count: tasks });
  }
}
