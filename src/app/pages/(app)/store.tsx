import { PlusIcon } from "lucide-react";
import { Link } from "waku";
import type { PageProps } from "waku/router";
import { hangar } from "#libs/hangar/server";
import { buttonVariants } from "#modules/common/ui/button.tsx";
import { installApp, uninstallApp } from "#modules/store/actions/store-apps.ts";
import { StoreAppCard } from "#modules/store/components/store-app-card.tsx";
import { StoreFilterMenu } from "#modules/store/components/store-filter-menu.tsx";
import { storeListing } from "#modules/store/listing.ts";
import { storeSearchCodec } from "#modules/store/search-codec.ts";

export default function StorePage({ search }: PageProps<"/store">) {
  const all = [...hangar.store.apps];
  const { apps, counts } = storeListing(all, search);

  return (
    <main>
      <title>Store | Hangar</title>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Store</h1>
        <div className="flex items-center gap-2">
          <StoreFilterMenu counts={counts} />
          <Link to="/store/new" className={buttonVariants({ variant: "outline" })}>
            <PlusIcon data-icon="inline-start" />
            Nouvelle app
          </Link>
        </div>
      </div>
      {apps.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
          {apps.map(app => (
            <StoreAppCard key={app.id} app={app} installApp={installApp} uninstallApp={uninstallApp} />
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
