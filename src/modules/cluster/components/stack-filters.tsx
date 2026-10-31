"use client";

import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import type { SwarmNode } from "#libs/docker";
import { ClusterMessages } from "#modules/cluster/messages.ts";
import { ClusterSearch, type StackHealth, type StackOrigin } from "#modules/cluster/search.ts";
import type { StackFilterCounts } from "#modules/cluster/stack-filter.ts";
import { CheckboxFilterMenu } from "#modules/common/components/checkbox-filter-menu.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";

type StackFiltersProps = {
  nodes: SwarmNode[];
  /** How many stacks each option keeps, shown beside its checkbox. */
  counts: StackFilterCounts;
};

/** The filters of the /cluster stack table: health, the nodes the tasks run on, and who deployed it. */
export function StackFilters({ nodes, counts }: StackFiltersProps) {
  const search = useSearch_UNSTABLE({ from: "/cluster" });
  const setSearch = useSetSearch_UNSTABLE({ from: "/cluster" });
  const { t } = useTranslation(ClusterMessages);

  return (
    <>
      <CheckboxFilterMenu
        label={t("filters.origin")}
        options={ClusterSearch.Origins.map(origin => ({
          value: origin,
          label: t(`origin.${origin}`),
          count: counts.origin[origin] ?? 0,
        }))}
        selected={search?.origin ?? []}
        onChange={origin => void setSearch({ origin: origin as StackOrigin[] })}
      />
      <CheckboxFilterMenu
        label={t("filters.node")}
        options={nodes.map(node => ({
          value: node.hostname,
          label: node.hostname,
          count: counts.node[node.hostname] ?? 0,
        }))}
        selected={search?.node ?? []}
        onChange={node => void setSearch({ node })}
      />
      <CheckboxFilterMenu
        label={t("filters.health")}
        options={ClusterSearch.Healths.map(health => ({
          value: health,
          label: t(`health.${health}`),
          count: counts.health[health] ?? 0,
        }))}
        selected={search?.health ?? []}
        onChange={health => void setSearch({ health: health as StackHealth[] })}
      />
    </>
  );
}
