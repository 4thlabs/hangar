"use client";

import { ArchiveIcon, DownloadIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "waku";
import type { BackupArchive } from "#libs/backups";
import { BackupsView, type BackupSchedule } from "#modules/apps/backups-view.ts";
import { formatBytes } from "#modules/apps/format.ts";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { AutoReload } from "#modules/common/components/auto-reload.tsx";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

type AppBackupsCardProps = {
  project: string;
  /** `null` when hangar.yml no longer declares a backup: the archives left can still be downloaded */
  schedule: BackupSchedule | null;
  /** Newest first */
  archives: BackupArchive[];
  /** Whether a backup is waiting or running */
  running: boolean;
  backupApp: (project: string) => Promise<ActionResult>;
  deleteBackup: (project: string, archive: string) => Promise<ActionResult>;
};

export function AppBackupsCard({ project, schedule, archives, running, backupApp, deleteBackup }: AppBackupsCardProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const [archiveToDelete, setArchiveToDelete] = useState<string | null>(null);

  const startBackup = () =>
    run(
      () => backupApp(project),
      { success: "Sauvegarde", error: "Échec de la sauvegarde" },
      () => router.reload(),
    );

  const confirmDelete = (archive: string) => {
    setArchiveToDelete(null);
    run(
      () => deleteBackup(project, archive),
      { success: "Archive supprimée", error: "Échec de la suppression" },
      () => router.reload(),
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sauvegardes</CardTitle>
        <CardDescription>{BackupsView.summary(schedule)}</CardDescription>
        <CardAction>
          <Button type="button" variant="outline" disabled={!schedule || running || isPending} onClick={startBackup}>
            {running ? <Spinner /> : <ArchiveIcon />}
            {running ? "Sauvegarde en cours…" : "Sauvegarder maintenant"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className={archives.length > 0 ? "px-0" : undefined}>
        {archives.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune archive pour l’instant.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Date</TableHead>
                <TableHead>Taille</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {archives.map(({ archive, size, createdAt }) => (
                <TableRow key={archive}>
                  <TableCell className="pl-6">{BackupsView.date(createdAt)}</TableCell>
                  <TableCell className="tabular-nums">{formatBytes(size)}</TableCell>
                  <TableCell className="pr-6">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="icon-sm"
                        variant="outline"
                        title="Télécharger"
                        aria-label={`Télécharger l’archive du ${BackupsView.date(createdAt)}`}
                        render={<a href={`/api/backups/${project}/${archive}`} download />}
                      >
                        <DownloadIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        title="Supprimer"
                        aria-label={`Supprimer l’archive du ${BackupsView.date(createdAt)}`}
                        disabled={isPending}
                        onClick={() => setArchiveToDelete(archive)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ConfirmDialog
        open={archiveToDelete !== null}
        title="Supprimer cette archive ?"
        description="L’archive est supprimée du disque ; elle ne pourra plus être téléchargée ni restaurée."
        confirmLabel="Supprimer"
        destructive
        onConfirm={() => archiveToDelete && confirmDelete(archiveToDelete)}
        onCancel={() => setArchiveToDelete(null)}
      />

      {running && <AutoReload seconds={BackupsView.RunningReloadSeconds} />}
    </Card>
  );
}
