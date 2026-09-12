import { manageStore } from "#app/actions/store/manage-store.ts";
import { StoreSettingsCard } from "#app/components/settings/store-settings-card.tsx";
import { hangar } from "#libs/hangar/server";

export default async function SettingsPage() {
  const installed = await hangar.store.isInstalled();

  return (
    <main>
      <title>Paramètres | Hangar</title>
      <div>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Gérez la configuration de votre installation Hangar.</p>
      </div>
      <StoreSettingsCard storeUrl={hangar.config.storeUrl()} initialInstalled={installed} manageStore={manageStore} />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
