"use client";

import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import { CheckboxFilterMenu } from "#app/components/common/checkbox-filter-menu.tsx";
import { APP_UPDATES, type AppUpdate } from "#app/search-codecs.ts";

/** What each update state is called in the menu. */
const updateLabel: Record<AppUpdate, string> = {
  available: "Disponible",
  current: "À jour",
};

type AppsUpdateFilterProps = {
  /** How many projects carry each update state, shown beside its checkbox. */
  counts: Record<string, number>;
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
