import { useNavigate, useSearch } from "@tanstack/react-router";
import type { AppCounts } from "#libs/api";
import { CheckboxFilterMenu } from "#modules/common/components/checkbox-filter-menu.tsx";
import {
  joinStoreFilters,
  parseStoreFilters,
  storeFilterLabels,
  storeFilters,
} from "#modules/store/helpers/store-search.ts";

type StoreFilterMenuProps = {
  /** How many apps are installed and how many are not, shown beside each checkbox. */
  counts: AppCounts | undefined;
};

/** The filters of `/store`, ticked in its URL. */
export function StoreFilterMenu({ counts }: StoreFilterMenuProps) {
  const search = useSearch({ from: "/_app/store" });
  const navigate = useNavigate({ from: "/store" });

  return (
    <CheckboxFilterMenu
      label="Installation"
      options={storeFilters.map(filter => ({
        value: filter,
        label: storeFilterLabels[filter],
        ...(counts ? { count: counts[filter] } : {}),
      }))}
      selected={parseStoreFilters(search.filter)}
      onChange={selected =>
        void navigate({
          search: previous => ({
            ...previous,
            filter: joinStoreFilters(parseStoreFilters(selected.join(","))),
          }),
          replace: true,
        })
      }
    />
  );
}
