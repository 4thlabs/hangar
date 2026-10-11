import { LockIcon, NetworkIcon, ServerIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import type { SwarmCluster } from "#libs/docker";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#modules/common/ui/empty.tsx";

/** Every state where this node cannot list the cluster. */
export type ClusterEmptyState = Exclude<SwarmCluster, { state: "manager" }>;

type EmptyText = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** What to run on the host to get out of this state, if anything. */
  command?: string;
};

function emptyText(cluster: ClusterEmptyState): EmptyText {
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

/** What /cluster shows when this node cannot describe the cluster, with the command that moves it on. */
export function ClusterEmpty({ cluster }: { cluster: ClusterEmptyState }) {
  const text = emptyText(cluster);

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <text.icon />
        </EmptyMedia>
        <EmptyTitle>{text.title}</EmptyTitle>
        <EmptyDescription>{text.description}</EmptyDescription>
      </EmptyHeader>
      {text.command && (
        <EmptyContent>
          <code className="rounded-md bg-muted px-3 py-2 font-mono text-sm">{text.command}</code>
        </EmptyContent>
      )}
    </Empty>
  );
}
