"use client";

import { useState } from "react";
import { DownloadIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "waku";
import type { StoreActionResult } from "#modules/store/actions/store-action-result.ts";
import { ComposeConfirmDialog } from "#modules/apps/components/compose-operations.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";

/** What the button looks like in each state. Uninstalling keeps its wording and only spins. */
const FACES = {
  available: { title: "Installer", label: (appName: string) => `Installer ${appName}`, icon: <DownloadIcon /> },
  installing: { title: "Installation…", label: (appName: string) => `Installation de ${appName}`, icon: <Spinner /> },
  installed: { title: "Désinstaller", label: (appName: string) => `Désinstaller ${appName}`, icon: <Trash2Icon /> },
  uninstalling: { title: "Désinstaller", label: (appName: string) => `Désinstaller ${appName}`, icon: <Spinner /> },
};

function buttonState(installed: boolean, isPending: boolean): keyof typeof FACES {
  if (installed) return isPending ? "uninstalling" : "installed";

  return isPending ? "installing" : "available";
}

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

  const face = FACES[buttonState(installed, isPending)];

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
        aria-label={face.label(appName)}
        title={face.title}
      >
        {face.icon}
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
