"use client";

import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import { AppsMessages } from "#modules/apps/messages.ts";
import { CheckboxFilterMenu } from "#modules/common/components/checkbox-filter-menu.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";

type AppsCategoryFilterProps = {
  /** How many projects carry each category, shown beside its checkbox. */
  counts: Partial<Record<string, number>>;
};

/** Lists categories from the installed apps, not `hangar.yml`, so no option filters to nothing. */
export function AppsCategoryFilter({ counts }: AppsCategoryFilterProps) {
  const search = useSearch_UNSTABLE({ from: "/apps" });
  const setSearch = useSetSearch_UNSTABLE({ from: "/apps" });
  const { t } = useTranslation(AppsMessages);
  const categories = Object.keys(counts).sort((a, b) => a.localeCompare(b));

  if (categories.length === 0) {
    return null;
  }

  return (
    <CheckboxFilterMenu
      label={t("filters.category")}
      options={categories.map(category => ({ value: category, label: category, count: counts[category] ?? 0 }))}
      selected={search?.category ?? []}
      onChange={category => void setSearch({ category })}
    />
  );
}
