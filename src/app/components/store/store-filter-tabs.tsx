"use client";

import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import { Tabs, TabsList, TabsTrigger } from "#app/components/ui/tabs.tsx";
import type { StoreFilter } from "#app/search-codecs.ts";

const filters: { value: StoreFilter; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "installed", label: "Installées" },
  { value: "available", label: "Non installées" },
];

export function StoreFilterTabs() {
  const search = useSearch_UNSTABLE({ from: "/store" });
  const setSearch = useSetSearch_UNSTABLE({ from: "/store" });

  return (
    <Tabs
      value={search?.filter ?? "all"}
      onValueChange={value => void setSearch({ filter: value as StoreFilter })}
      aria-label="Filtrer les applications"
    >
      <TabsList>
        {filters.map(filter => (
          <TabsTrigger key={filter.value} value={filter.value}>
            {filter.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
