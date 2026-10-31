"use client";

import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import { AppsMessages } from "#modules/apps/messages.ts";
import { APP_UPDATES, type AppUpdate } from "#modules/apps/search-codec.ts";
import { CheckboxFilterMenu } from "#modules/common/components/checkbox-filter-menu.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";

type AppsUpdateFilterProps = {
  /** How many projects carry each update state, shown beside its checkbox. */
  counts: Partial<Record<AppUpdate, number>>;
};

export function AppsUpdateFilter({ counts }: AppsUpdateFilterProps) {
  const search = useSearch_UNSTABLE({ from: "/apps" });
  const setSearch = useSetSearch_UNSTABLE({ from: "/apps" });
  const { t } = useTranslation(AppsMessages);

  return (
    <CheckboxFilterMenu
      label={t("filters.update")}
      options={APP_UPDATES.map(update => ({
        value: update,
        label: t(`filters.updates.${update}`),
        count: counts[update] ?? 0,
      }))}
      selected={search?.update ?? []}
      onChange={update => void setSearch({ update: update as AppUpdate[] })}
    />
  );
}
