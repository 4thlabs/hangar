import { LockIcon, NetworkIcon, ServerIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import type {
  SwarmLimitedView,
  SwarmManagerView,
  SwarmNode,
  SwarmNodeAvailability,
  SwarmNodeStatus,
} from "#libs/docker";
import { SwarmRules } from "#libs/docker/swarm-rules";
import type { Translate } from "#libs/i18n";
import type { ClusterMessages } from "#modules/cluster/messages.ts";
import type { StackHealth } from "#modules/cluster/search.ts";

/** The words of /cluster, in the reader's language. */
type ClusterTranslate = Translate<typeof ClusterMessages.en>;

/** What /cluster shows when this node cannot describe the cluster. */
export type ClusterEmptyText = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** What to run on the host to get out of this state, if anything. */
  command?: string;
};

/** How /cluster marks the swarm: symbols, badge variants, and the summaries built from `ClusterMessages`. */
export class ClusterLabels {
  /** The dot before a stack: full, half or empty, as its replicas run, and dotted when it runs nowhere yet. */
  static readonly HealthSymbol: Record<StackHealth, string> = {
    running: "●",
    partial: "◐",
    stopped: "○",
    undeployed: "◌",
  };

  static readonly HealthClass: Record<StackHealth, string> = {
    running: "text-emerald-600 dark:text-emerald-400",
    partial: "text-amber-600 dark:text-amber-400",
    stopped: "text-destructive",
    undeployed: "text-muted-foreground",
  };

  /** How many characters of the cluster id the page shows, as the `docker` CLI shortens ids. */
  private static readonly ShortIdLength = 12;

  /** A manager in its spec only, which the quorum does not count. */
  static isOutsideRaft(node: Pick<SwarmNode, "role" | "isRaftMember">) {
    return node.role === "manager" && !node.isRaftMember;
  }

  /** The node's role in a word, a manager outside Raft told apart from one the quorum counts. */
  static role(node: Pick<SwarmNode, "role" | "isRaftMember">, t: ClusterTranslate) {
    if (ClusterLabels.isOutsideRaft(node)) {
      return t("outsideRaft");
    }

    return t(`role.${node.role}`);
  }

  /** Only the leader is filled: a plain manager would otherwise read as one at a glance. */
  static roleVariant(node: Pick<SwarmNode, "role" | "isRaftMember">) {
    if (node.role === "leader") {
      return "default";
    }

    if (node.role === "manager" && node.isRaftMember) {
      return "secondary";
    }

    return "outline";
  }

  /** A node the managers cannot reach reads as a fault; one they hear from, as a plain fact. */
  static nodeStatusVariant(status: SwarmNodeStatus) {
    return status === "ready" ? "secondary" : "destructive";
  }

  /** A drained or paused node takes no new task, which deserves to stand out. */
  static availabilityVariant(availability: SwarmNodeAvailability) {
    return availability === "active" ? "secondary" : "outline";
  }

  /** A label as `docker node inspect` would set it: `key=value`, or the key alone when it has no value. */
  static label(key: string, value: string) {
    return value ? `${key}=${value}` : key;
  }

  /** The one line under the title: which cluster, how big, how much it can lose. */
  static summary(cluster: SwarmManagerView, t: ClusterTranslate) {
    return t("summary", {
      id: cluster.clusterId.slice(0, ClusterLabels.ShortIdLength),
      nodes: cluster.nodes.length,
      managers: cluster.managers,
      tolerance: SwarmRules.faultTolerance(cluster.managers),
    });
  }

  /** What /cluster says when this node cannot describe the cluster, with the command that moves it on. */
  static empty(cluster: SwarmLimitedView, t: ClusterTranslate): ClusterEmptyText {
    switch (cluster.state) {
      case "inactive":
        return { icon: NetworkIcon, title: t("empty.inactiveTitle"), description: t("empty.inactiveDescription") };
      case "pending":
        return { icon: NetworkIcon, title: t("empty.pendingTitle"), description: t("empty.pendingDescription") };
      case "locked":
        return {
          icon: LockIcon,
          title: t("empty.lockedTitle"),
          description: t("empty.lockedDescription"),
          command: "docker swarm unlock",
        };
      case "error":
        return {
          icon: TriangleAlertIcon,
          title: t("empty.errorTitle"),
          description: cluster.error || t("empty.errorDescription"),
        };
      case "worker":
        return {
          icon: ServerIcon,
          title: t("empty.workerTitle"),
          description: t("empty.workerDescription", {
            managers: cluster.managers.join(", ") || t("empty.unknownAddress"),
          }),
          command: "docker node ls",
        };
    }
  }
}
