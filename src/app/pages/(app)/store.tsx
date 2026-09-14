import fuzzysort from "fuzzysort";
import type { PageProps } from "waku/router";
import { installApp } from "#app/actions/store/install-app.ts";
import { StoreAppCard } from "#app/components/store/store-app-card.tsx";
import { StoreFilterTabs } from "#app/components/store/store-filter-tabs.tsx";
import { storeSearchCodec } from "#app/search-codecs.ts";
import { hangar } from "#libs/hangar/server";

export default function StorePage({ search }: PageProps<"/store">) {
  const all = [...hangar.store.apps];
  const filtered = search.filter === "all" ? all : all.filter(app => app.installed === (search.filter === "installed"));
  // fuzzysort already orders by relevance; alphabetical is only the no-query fallback.
  // threshold 0: fuzzysort still requires the query's chars in order, so the score cutoff only
  // drops typo-tolerant hits. ponytail: subsequence matching misses transpositions ("nextcould"),
  // swap in a trigram/Levenshtein matcher if that shows up in practice.
  const apps = search.q
    ? fuzzysort.go(search.q, filtered, { key: "name", limit: 0, threshold: 0 }).map(result => result.obj)
    : filtered.sort((left, right) => left.name.localeCompare(right.name));

  return (
    <main>
      <title>Store | Hangar</title>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Store</h1>
        <StoreFilterTabs />
      </div>
      {apps.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {apps.map(app => (
            <StoreAppCard key={app.id} app={app} installApp={installApp} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {all.length === 0
            ? "Aucune application disponible dans le store."
            : "Aucune application ne correspond à cette recherche."}
        </p>
      )}
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
    unstable_searchCodec: storeSearchCodec,
  } as const;
};
