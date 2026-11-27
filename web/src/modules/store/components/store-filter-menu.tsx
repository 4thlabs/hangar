import { useNavigate, useSearch } from "@tanstack/react-router";
import type { AppCounts } from "#libs/api";
import { CheckboxFilterMenu } from "#modules/common/components/checkbox-filter-menu.tsx";
import { joinStoreFilters, parseStoreFilters, storeFilters } from "#modules/store/helpers/store-search.ts";
import { storeMessages } from "#modules/store/messages.ts";

type StoreFilterMenuProps = {
  /** How many apps are installed and how many are not, shown beside each checkbox. */
  counts: AppCounts | undefined;
};

/** The filters of `/store`, ticked in its URL. */
export function StoreFilterMenu({ counts }: StoreFilterMenuProps) {
  const search = useSearch({ from: "/_app/store/" });
  const navigate = useNavigate({ from: "/store/" });

  return (
    <CheckboxFilterMenu
      label={storeMessages.filterMenu}
      options={storeFilters.map(filter => ({
        value: filter,
        label: storeMessages.filter[filter],
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
