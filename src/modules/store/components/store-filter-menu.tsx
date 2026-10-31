"use client";

import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import { CheckboxFilterMenu } from "#modules/common/components/checkbox-filter-menu.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { StoreMessages } from "#modules/store/messages.ts";
import { STORE_FILTERS, type StoreFilter } from "#modules/store/search-codec.ts";

type StoreFilterMenuProps = {
  /** How many apps are installed and how many are not, shown beside each checkbox. */
  counts: Record<StoreFilter, number>;
};

export function StoreFilterMenu({ counts }: StoreFilterMenuProps) {
  const search = useSearch_UNSTABLE({ from: "/store" });
  const setSearch = useSetSearch_UNSTABLE({ from: "/store" });
  const { t } = useTranslation(StoreMessages);

  return (
    <CheckboxFilterMenu
      label={t("filter.label")}
      options={STORE_FILTERS.map(filter => ({ value: filter, label: t(`filter.${filter}`), count: counts[filter] }))}
      selected={search?.filter ?? []}
      onChange={filter => void setSearch({ filter: filter as StoreFilter[] })}
    />
  );
}
