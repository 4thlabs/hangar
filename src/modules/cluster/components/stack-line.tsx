import type { SwarmStackHealth } from "#libs/docker";
import { ClusterLabels } from "#modules/cluster/labels.ts";

type StackLineProps = {
  name: string;
  health: SwarmStackHealth;
  /** What the line says on the right, such as how many of its tasks run there. */
  detail: string;
  onOpen: (stack: string) => void;
};

/** One stack, with its health across the cluster; a click opens its sheet. */
export function StackLine({ name, health, detail, onOpen }: StackLineProps) {
  return (
    <button
      type="button"
      className="-mx-1.5 flex w-[calc(100%+--spacing(3))] items-center gap-2 rounded-md px-1.5 py-0.5 text-left hover:bg-muted"
      onClick={() => onOpen(name)}
    >
      <span className={ClusterLabels.HealthClass[health]} title={ClusterLabels.Health[health]} aria-hidden>
        {ClusterLabels.HealthSymbol[health]}
      </span>
      <span className="sr-only">{ClusterLabels.Health[health]}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      <span className="text-muted-foreground">{detail}</span>
    </button>
  );
}
