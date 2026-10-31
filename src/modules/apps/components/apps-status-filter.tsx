"use client";

import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import type { ComposeProjectStatus } from "#libs/docker";
import { AppsMessages } from "#modules/apps/messages.ts";
import { APP_STATUSES } from "#modules/apps/search-codec.ts";
import { CheckboxFilterMenu } from "#modules/common/components/checkbox-filter-menu.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";

type AppsStatusFilterProps = {
  /** How many projects carry each status, shown beside its checkbox. */
  counts: Partial<Record<ComposeProjectStatus, number>>;
};

export function AppsStatusFilter({ counts }: AppsStatusFilterProps) {
  const search = useSearch_UNSTABLE({ from: "/apps" });
  const setSearch = useSetSearch_UNSTABLE({ from: "/apps" });
  const { t } = useTranslation(AppsMessages);

  return (
    <CheckboxFilterMenu
      label={t("filters.status")}
      options={APP_STATUSES.map(status => ({
        value: status,
        label: t(`status.${status}`),
        count: counts[status] ?? 0,
      }))}
      selected={search?.status ?? []}
      onChange={status => void setSearch({ status: status as ComposeProjectStatus[] })}
    />
  );
}
