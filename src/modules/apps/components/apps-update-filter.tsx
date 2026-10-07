"use client";

import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import { APP_UPDATES, type AppUpdate } from "#modules/apps/search-codec.ts";
import { CheckboxFilterMenu } from "#modules/common/components/checkbox-filter-menu.tsx";

/** What each update state is called in the menu. */
const updateLabel: Record<AppUpdate, string> = {
  available: "Disponible",
  current: "À jour",
};

type AppsUpdateFilterProps = {
  /** How many projects carry each update state, shown beside its checkbox. */
  counts: Partial<Record<AppUpdate, number>>;
};

export function AppsUpdateFilter({ counts }: AppsUpdateFilterProps) {
  const search = useSearch_UNSTABLE({ from: "/apps" });
  const setSearch = useSetSearch_UNSTABLE({ from: "/apps" });

  return (
    <CheckboxFilterMenu
      label="Mise à jour"
      options={APP_UPDATES.map(update => ({
        value: update,
        label: updateLabel[update],
        count: counts[update] ?? 0,
      }))}
      selected={search?.update ?? []}
      onChange={update => void setSearch({ update: update as AppUpdate[] })}
    />
  );
}
