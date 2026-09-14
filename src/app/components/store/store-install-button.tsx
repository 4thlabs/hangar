"use client";

import { DownloadIcon } from "lucide-react";
import { useRouter } from "waku";
import type { StoreActionResult } from "#app/actions/store/store-action-result.ts";
import { Button } from "#app/components/ui/button.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { useServerAction } from "#app/hooks/use-server-action.ts";

type StoreInstallButtonProps = {
  appId: string;
  appName: string;
  installApp: (appId: string) => Promise<StoreActionResult>;
};

/**
 * The only interactive part of a store card, split out so the card itself stays a server
 * component: the whole catalogue would otherwise ship to the client for one button per app.
 */
export function StoreInstallButton({ appId, appName, installApp }: StoreInstallButtonProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();

  const handleInstall = () =>
    run(
      () => installApp(appId),
      { success: "Application installée", error: "Échec de l’installation" },
      // The list and its filter are computed server-side; refetch so both follow.
      () => router.reload(),
    );

  return (
    <Button
      type="button"
      size="icon-xs"
      className="absolute top-1.5 right-1.5"
      disabled={isPending}
      onClick={handleInstall}
      aria-label={isPending ? `Installation de ${appName}` : `Installer ${appName}`}
      title={isPending ? "Installation…" : "Installer"}
    >
      {isPending ? <Spinner /> : <DownloadIcon />}
    </Button>
  );
}
