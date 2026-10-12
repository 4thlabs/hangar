import { LockIcon, NetworkIcon, ServerIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import type {
  SwarmJoinCommands,
  SwarmLimitedView,
  SwarmManagerView,
  SwarmNodeAction,
  SwarmNodeAvailability,
  SwarmNodeRole,
  SwarmNodeStatus,
} from "#libs/docker";
import { SwarmRules } from "#libs/docker/swarm-rules";
import { plural } from "#modules/apps/format.ts";
import type { StackHealth, StackOrigin } from "#modules/cluster/search.ts";

/** What /cluster shows when this node cannot describe the cluster. */
export type ClusterEmptyText = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** What to run on the host to get out of this state, if anything. */
  command?: string;
};

/** How /cluster words and marks the swarm: labels, symbols, badge variants and summaries. */
export class ClusterLabels {
  static readonly Role: Record<SwarmNodeRole, string> = {
    leader: "Leader",
    manager: "Manager",
    worker: "Worker",
  };

  static readonly NodeStatus: Record<SwarmNodeStatus, string> = {
    ready: "Prêt",
    down: "Injoignable",
    unknown: "Inconnu",
    disconnected: "Déconnecté",
  };

  static readonly Availability: Record<SwarmNodeAvailability, string> = {
    active: "Actif",
    pause: "En pause",
    drain: "Drainé",
  };

  static readonly Health: Record<StackHealth, string> = {
    running: "Tous les réplicas tournent",
    partial: "Une partie des réplicas tourne",
    stopped: "Aucun réplica ne tourne",
    undeployed: "Installée, pas encore déployée sur le swarm",
  };

  /** The health in a word, for the table and its filter. */
  static readonly HealthShort: Record<StackHealth, string> = {
    running: "En cours",
    partial: "Partielle",
    stopped: "Arrêtée",
    undeployed: "Non déployée",
  };

  static readonly Origin: Record<StackOrigin, string> = {
    hangar: "Hangar",
    other: "Autres",
  };

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

  static readonly NodeAction: Record<SwarmNodeAction, string> = {
    promote: "Promouvoir",
    demote: "Rétrograder",
    drain: "Drainer",
    activate: "Réactiver",
    remove: "Retirer",
  };

  /** What each node action did, for the success toast. */
  static readonly NodeActionDone: Record<SwarmNodeAction, (hostname: string) => string> = {
    promote: hostname => `${hostname} est maintenant manager.`,
    demote: hostname => `${hostname} est maintenant worker.`,
    drain: hostname => `${hostname} est drainé : ses tâches partent sur les autres nœuds.`,
    activate: hostname => `${hostname} peut de nouveau recevoir des tâches.`,
    remove: hostname => `${hostname} a été retiré du cluster.`,
  };

  static readonly JoinRoleTitle: Record<keyof SwarmJoinCommands, string> = {
    worker: "Ajouter un worker",
    manager: "Ajouter un manager",
  };

  /** What the daemon needs when the host has several addresses and cannot pick the one to advertise. */
  static readonly AdvertiseHint =
    "Facultatif. À préciser si le serveur a plusieurs adresses : une IP ou une interface (eth0).";

  /** What sets an engine label, and why the page cannot change it. */
  static readonly EngineLabelHint = "Label du moteur, défini dans le daemon.json de l’hôte";

  /** Why a node label is refused, as the dialog shows it under the field and the action in its toast. */
  static readonly InvalidLabel =
    "Clé : lettres, chiffres, « . », « _ » et « - », sans espace. Valeur : une seule ligne, 255 caractères au plus.";

  /** How many characters of the cluster id the page shows, as the `docker` CLI shortens ids. */
  private static readonly ShortIdLength = 12;

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
  static summary(cluster: SwarmManagerView) {
    const tolerance = `tolère ${plural(SwarmRules.faultTolerance(cluster.managers), "panne")}`;

    return [
      cluster.clusterId.slice(0, ClusterLabels.ShortIdLength),
      plural(cluster.nodes.length, "nœud"),
      `${plural(cluster.managers, "manager")} (${tolerance})`,
    ].join(" · ");
  }

  /** What /cluster says when this node cannot describe the cluster, with the command that moves it on. */
  static empty(cluster: SwarmLimitedView): ClusterEmptyText {
    switch (cluster.state) {
      case "inactive":
        return {
          icon: NetworkIcon,
          title: "Aucun swarm",
          description: "Ce nœud ne fait partie d'aucun cluster Swarm : créez-en un, ou rejoignez-en un existant.",
        };
      case "pending":
        return {
          icon: NetworkIcon,
          title: "Connexion au swarm en cours",
          description: "Ce nœud est en train de rejoindre un cluster. La page se mettra à jour d'elle-même.",
        };
      case "locked":
        return {
          icon: LockIcon,
          title: "Swarm verrouillé",
          description:
            "L'autolock est actif et ce manager a redémarré : il attend la clé de déverrouillage. Sur le serveur :",
          command: "docker swarm unlock",
        };
      case "error":
        return {
          icon: TriangleAlertIcon,
          title: "Swarm en erreur",
          description: cluster.error || "Le daemon signale une erreur Swarm sans la détailler.",
        };
      case "worker":
        return {
          icon: ServerIcon,
          title: "Ce nœud est un worker",
          description: `Seul un manager voit tout le cluster. Pour lister les nœuds, sur un manager (${cluster.managers.join(", ") || "adresse inconnue"}) :`,
          command: "docker node ls",
        };
    }
  }
}
