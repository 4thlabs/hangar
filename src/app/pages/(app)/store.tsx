import { installApp } from "#app/actions/install-app.ts";
import { StoreAppCard } from "#app/components/store/store-app-card.tsx";
import { hangar } from "#libs/hangar";

export default function StorePage() {
  const apps = [...hangar.store.apps].sort((left, right) => left.name.localeCompare(right.name));

  return (
    <main>
      <title>Store | Hangar</title>
      <div>
        <h1 className="text-2xl font-semibold">Store</h1>
      </div>
      {apps.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {apps.map(app => (
            <StoreAppCard key={app.id} app={app} installApp={installApp} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Aucune application disponible dans le store.</p>
      )}
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
