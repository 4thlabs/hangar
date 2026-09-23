import { PlusIcon } from "lucide-react";
import { Link } from "waku";
import type { PageProps } from "waku/router";
import { installApp } from "#app/actions/store/install-app.ts";
import { uninstallApp } from "#app/actions/store/uninstall-app.ts";
import { StoreAppCard } from "#app/components/store/store-app-card.tsx";
import { buttonVariants } from "#app/components/ui/button.tsx";
import { StoreFilterMenu } from "#app/components/store/store-filter-menu.tsx";
import { searchByName } from "#app/search.ts";
import { storeSearchCodec } from "#app/search-codecs.ts";
import { hangar } from "#libs/hangar/server";

export default function StorePage({ search }: PageProps<"/store">) {
  const all = [...hangar.store.apps];
  // An empty selection means no filter; ticking both is the same as ticking neither.
  const filtered =
    search.filter.length === 0
      ? all
      : all.filter(app => search.filter.includes(app.installed ? "installed" : "available"));
  const counts = {
    installed: all.filter(app => app.installed).length,
    available: all.filter(app => !app.installed).length,
  };
  const apps = searchByName(search.q, filtered);

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
        <div className="flex flex-wrap gap-3">
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
