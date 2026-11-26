import { useNavigate, useSearch } from "@tanstack/react-router";
import type { AppCounts } from "#libs/api";
import { CheckboxFilterMenu } from "#modules/common/components/checkbox-filter-menu.tsx";
import { StoreSearchParams } from "#modules/store/store-search.ts";

type StoreFilterMenuProps = {
  /** How many apps are installed and how many are not, shown beside each checkbox. */
  counts: AppCounts | undefined;
};

/** The filters of `/store`, ticked in its URL. */
export function StoreFilterMenu({ counts }: StoreFilterMenuProps) {
  const search = useSearch({ from: "/app/store" });
  const navigate = useNavigate({ from: "/store" });

  return (
    <CheckboxFilterMenu
      label="Installation"
      options={StoreSearchParams.Filters.map(filter => ({
        value: filter,
        label: StoreSearchParams.Labels[filter],
        ...(counts ? { count: counts[filter] } : {}),
      }))}
      selected={StoreSearchParams.read(search.filter)}
      onChange={selected =>
        void navigate({
          search: previous => ({
            ...previous,
            filter: StoreSearchParams.write(StoreSearchParams.read(selected.join(","))),
          }),
          replace: true,
        })
      }
    />
  );
}
