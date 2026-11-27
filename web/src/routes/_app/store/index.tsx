import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { searchByName } from "#modules/common/helpers/search-by-name.ts";
import { buttonVariants } from "#modules/common/ui/button.tsx";
import { storeQueries } from "#modules/store/api/store-queries.ts";
import { StoreAppCard } from "#modules/store/components/store-app-card.tsx";
import { StoreFilterMenu } from "#modules/store/components/store-filter-menu.tsx";
import { parseStoreFilters, validateStoreSearch } from "#modules/store/helpers/store-search.ts";

/** `/store`, the store's apps, filtered by its search. */
export const Route = createFileRoute("/_app/store/")({
  validateSearch: validateStoreSearch,
  staticData: { searchable: true },
  component: StorePage,
});

/** `/store`: the store's apps, the filters of the URL applied by the server, then its `q` by name. */
function StorePage() {
  const search = useSearch({ from: "/_app/store/" });
  const filters = parseStoreFilters(search.filter);
  const { data, error, isPending } = useQuery(storeQueries.apps(filters));
  const apps = searchByName(search.q ?? "", data?.apps ?? []);
  const total = (data?.counts.installed ?? 0) + (data?.counts.available ?? 0);

  return (
    <main>
      <title>Store | Hangar</title>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Store</h1>
        <div className="flex items-center gap-2">
          <StoreFilterMenu counts={data?.counts} />
          <Link to="/store/new" className={buttonVariants({ variant: "outline" })}>
            <PlusIcon data-icon="inline-start" />
            New app
          </Link>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{describeError(error)}</p>}
      {apps.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
          {apps.map(app => (
            <StoreAppCard key={app.id} app={app} />
          ))}
        </div>
      )}
      {data && apps.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {total === 0 ? "No apps available in the store." : "No app matches this search."}
        </p>
      )}
      {isPending && <p className="text-sm text-muted-foreground">Loading the store…</p>}
    </main>
  );
}
