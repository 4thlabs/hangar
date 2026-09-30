"use client";

import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import { statusLabel } from "#modules/apps/status.ts";
import { CheckboxFilterMenu } from "#modules/common/components/checkbox-filter-menu.tsx";
import { APP_STATUSES } from "#modules/apps/search-codec.ts";
import type { ComposeProjectStatus } from "#libs/docker";

type AppsStatusFilterProps = {
  /** How many projects carry each status, shown beside its checkbox. */
  counts: Record<string, number>;
};

export function AppsStatusFilter({ counts }: AppsStatusFilterProps) {
  const search = useSearch_UNSTABLE({ from: "/apps" });
  const setSearch = useSetSearch_UNSTABLE({ from: "/apps" });

  return (
    <CheckboxFilterMenu
      label="Statut"
      options={APP_STATUSES.map(status => ({
        value: status,
        label: statusLabel[status],
        count: counts[status] ?? 0,
      }))}
      selected={search?.status ?? []}
      onChange={status => void setSearch({ status: status as ComposeProjectStatus[] })}
    />
  );
}
