"use client";

import { DownloadIcon, EllipsisIcon, FilePenIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "waku";
import { AppCommands } from "#modules/apps/actions/app-operation.ts";
import { installApp, uninstallApp } from "#modules/apps/actions/install-app.ts";
import { ComposeConfirmDialog } from "#modules/apps/components/compose-operations.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { Button } from "#modules/common/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#modules/common/ui/dropdown-menu.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

type AppRowActionsProps = {
  /** The store app's id */
  app: string;
  installed: boolean;
};

/**
 * What a row of the Apps or Cluster table offers on its store app: Install when it is not installed, and a menu
 * to edit its files or uninstall it. Both rows refetch once it is done, their lists being read on the server.
 */
export function AppRowActions({ app, installed }: AppRowActionsProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const [confirming, setConfirming] = useState(false);

  const install = () =>
    run(
      () => installApp(app),
      { success: "Application installée", error: "Échec de l’installation" },
      () => router.reload(),
    );

  const uninstall = () => {
    setConfirming(false);
    run(
      () => uninstallApp(app),
      { success: "Application désinstallée", error: "Échec de la désinstallation" },
      () => router.reload(),
    );
  };

  return (
    <div className="flex items-center justify-end gap-1">
      {!installed && (
        <Button type="button" size="xs" disabled={isPending} onClick={install}>
          {isPending ? <Spinner /> : <DownloadIcon data-icon="inline-start" />}
          Installer
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="ghost" size="icon-xs" aria-label={`Actions de ${app}`} />}
        >
          {installed && isPending ? <Spinner /> : <EllipsisIcon />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem onClick={() => void router.push({ to: "/apps/[project]/edit", params: { project: app } })}>
            <FilePenIcon />
            Modifier
          </DropdownMenuItem>
          {installed && (
            <DropdownMenuItem variant="destructive" disabled={isPending} onClick={() => setConfirming(true)}>
              <Trash2Icon />
              Désinstaller
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Reuses the apps confirmation: unlinking runs `docker compose down` first, same stakes. */}
      <ComposeConfirmDialog
        command={confirming ? AppCommands.create("down") : null}
        title={`Désinstaller ${app} ?`}
        description="Les conteneurs de l’application sont arrêtés et supprimés, puis l’application est retirée des applications installées. Les volumes sont conservés."
        onConfirm={uninstall}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
