"use client";

import { useState } from "react";
import { DownloadIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "waku";
import type { StoreActionResult } from "#app/actions/store/store-action-result.ts";
import { ComposeConfirmDialog } from "#app/components/apps/compose-operations.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { useServerAction } from "#app/hooks/use-server-action.ts";

type StoreAppButtonProps = {
  appId: string;
  appName: string;
  installed: boolean;
  installApp: (appId: string) => Promise<StoreActionResult>;
  uninstallApp: (appId: string) => Promise<StoreActionResult>;
};

/**
 * The only interactive part of a store card, split out so the card itself stays a server
 * component: the whole catalogue would otherwise ship to the client for one button per app.
 */
export function StoreAppButton({ appId, appName, installed, installApp, uninstallApp }: StoreAppButtonProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const [confirming, setConfirming] = useState(false);

  const handle = (action: () => Promise<StoreActionResult>, success: string, error: string) =>
    run(
      action,
      { success, error },
      // The list and its filter are computed server-side; refetch so both follow.
      () => router.reload(),
    );

  const install = () => handle(() => installApp(appId), "Application installée", "Échec de l’installation");

  const uninstall = () => {
    setConfirming(false);
    handle(() => uninstallApp(appId), "Application désinstallée", "Échec de la désinstallation");
  };

  return (
    <>
      <Button
        type="button"
        size="icon-xs"
        variant={installed ? "outline" : "default"}
        className="absolute top-1.5 right-1.5"
        disabled={isPending}
        onClick={installed ? () => setConfirming(true) : install}
        aria-label={
          installed ? `Désinstaller ${appName}` : isPending ? `Installation de ${appName}` : `Installer ${appName}`
        }
        title={installed ? "Désinstaller" : isPending ? "Installation…" : "Installer"}
      >
        {isPending ? <Spinner /> : installed ? <Trash2Icon /> : <DownloadIcon />}
      </Button>
      {/* Reuses the apps confirmation: unlinking runs `docker compose down` first, same stakes. */}
      <ComposeConfirmDialog
        operation={confirming ? "down" : null}
        title={`Désinstaller ${appName} ?`}
        description="Les conteneurs de l’application sont arrêtés et supprimés, puis l’application est retirée des applications installées. Les volumes sont conservés."
        onConfirm={uninstall}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
