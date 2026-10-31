import { ServerIcon } from "lucide-react";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import { ClusterMessages } from "#modules/cluster/messages.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Badge } from "#modules/common/ui/badge.tsx";

type NodeLabelBadgeProps = {
  name: string;
  value: string;
  /** `engine` for a label from the host's `daemon.json`, marked apart: only the host changes it. */
  source: "node" | "engine";
};

/** One label of a node, `key=value`, cut short rather than overflowing its card. */
export function NodeLabelBadge({ name, value, source }: NodeLabelBadgeProps) {
  const { t } = useTranslation(ClusterMessages);
  const label = ClusterLabels.label(name, value);

  if (source === "node") {
    return (
      <Badge variant="secondary" className="max-w-full font-mono" title={label}>
        <span className="truncate">{label}</span>
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="max-w-full font-mono" title={t("labels.engineTitle", { label })}>
      <ServerIcon data-icon="inline-start" aria-hidden />
      <span className="sr-only">{t("labels.engineTitle", { label: "" })}</span>
      <span className="truncate">{label}</span>
    </Badge>
  );
}
