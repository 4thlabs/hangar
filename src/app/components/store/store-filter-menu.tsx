"use client";

import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import { CheckboxFilterMenu } from "#app/components/common/checkbox-filter-menu.tsx";
import { STORE_FILTERS, type StoreFilter } from "#app/search-codecs.ts";

const labels: Record<StoreFilter, string> = {
  installed: "Installées",
  available: "Non installées",
};

type StoreFilterMenuProps = {
  /** How many apps are installed and how many are not, shown beside each checkbox. */
  counts: Record<StoreFilter, number>;
};

export function StoreFilterMenu({ counts }: StoreFilterMenuProps) {
  const search = useSearch_UNSTABLE({ from: "/store" });
  const setSearch = useSetSearch_UNSTABLE({ from: "/store" });

  return (
    <CheckboxFilterMenu
      label="Installation"
      options={STORE_FILTERS.map(filter => ({ value: filter, label: labels[filter], count: counts[filter] }))}
      selected={search?.filter ?? []}
      onChange={filter => void setSearch({ filter: filter as StoreFilter[] })}
    />
  );
}
