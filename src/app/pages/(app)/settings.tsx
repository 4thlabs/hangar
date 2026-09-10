import type { StoreActionResult } from "#app/components/settings/store-settings-card.tsx";
import { StoreSettingsCard } from "#app/components/settings/store-settings-card.tsx";
import { requireSession } from "#libs/auth";
import { logger } from "#libs/logs";
import { config, install, isStoreInstalled, update } from "#libs/store";

const manageStore = async (): Promise<StoreActionResult> => {
  "use server";

  await requireSession();
  
  const wasInstalled = await isStoreInstalled();
  const operation = wasInstalled ? "mise à jour" : "installation";

  try {
    const code = wasInstalled ? await update() : await install();
    const installed = await isStoreInstalled();

    if (code !== 0) {
      return {
        success: false,
        installed,
        message: `La ${operation} du store a échoué (code ${code}). Consultez les logs du serveur.`,
      };
    }

    return {
      success: true,
      installed,
      message: wasInstalled ? "Le store a été mis à jour." : "Le store a été installé.",
    };
  } catch (error) {
    logger.error({ error, operation }, "Store management failed");

    return {
      success: false,
      installed: await isStoreInstalled(),
      message: `La ${operation} du store a échoué. Consultez les logs du serveur.`,
    };
  }
};

export default async function SettingsPage() {
  const installed = await isStoreInstalled();

  return (
    <main className="flex flex-1 flex-col gap-6">
      <title>Paramètres | Hangar</title>
      <div>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Gérez la configuration de votre installation Hangar.</p>
      </div>
      <StoreSettingsCard storeUrl={config.store} initialInstalled={installed} manageStore={manageStore} />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
