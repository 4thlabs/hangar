"use client";

import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import { CheckboxFilterMenu } from "#app/components/common/checkbox-filter-menu.tsx";

type AppsCategoryFilterProps = {
  /** How many projects carry each category, shown beside its checkbox. */
  counts: Record<string, number>;
};

/**
 * Categories are listed from the installed apps rather than from `hangar.yml`: a category whose
 * stacks are all uninstalled would only add an option that filters to nothing.
 */
export function AppsCategoryFilter({ counts }: AppsCategoryFilterProps) {
  const search = useSearch_UNSTABLE({ from: "/apps" });
  const setSearch = useSetSearch_UNSTABLE({ from: "/apps" });
  const categories = Object.keys(counts).sort((a, b) => a.localeCompare(b));

  if (categories.length === 0) return null;

  return (
    <CheckboxFilterMenu
      label="Catégorie"
      options={categories.map(category => ({ value: category, label: category, count: counts[category] ?? 0 }))}
      selected={search?.category ?? []}
      onChange={category => void setSearch({ category })}
    />
  );
}
