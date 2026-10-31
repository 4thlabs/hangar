"use client";

import { ArchiveIcon, DownloadIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "waku";
import type { BackupArchive } from "#libs/backups";
import { BackupsView, type BackupSchedule } from "#modules/apps/backups-view.ts";
import { MetricFormat } from "#modules/apps/format.ts";
import { AppsMessages } from "#modules/apps/messages.ts";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { AutoReload } from "#modules/common/components/auto-reload.tsx";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { LocalDateTime } from "#modules/common/components/local-date-time.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
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
  const { t, locale } = useTranslation(AppsMessages);
  const [archiveToDelete, setArchiveToDelete] = useState<string | null>(null);

  const startBackup = () =>
    run(
      () => backupApp(project),
      { success: t("backups.started"), error: t("backups.startFailed") },
      () => router.reload(),
    );

  const confirmDelete = (archive: string) => {
    setArchiveToDelete(null);
    run(
      () => deleteBackup(project, archive),
      { success: t("backups.deleted"), error: t("backups.deleteFailed") },
      () => router.reload(),
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("backups.title")}</CardTitle>
        <CardDescription>{BackupsView.summary(schedule, t)}</CardDescription>
        <CardAction>
          <Button type="button" variant="outline" disabled={!schedule || running || isPending} onClick={startBackup}>
            {running ? <Spinner /> : <ArchiveIcon />}
            {running ? t("backups.running") : t("backups.backUpNow")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className={archives.length > 0 ? "px-0" : undefined}>
        {archives.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("backups.none")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">{t("backups.date")}</TableHead>
                <TableHead>{t("backups.size")}</TableHead>
                <TableHead className="pr-6 text-right">{t("backups.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {archives.map(({ archive, size, createdAt }) => (
                <TableRow key={archive}>
                  <TableCell className="pl-6">
                    <LocalDateTime value={createdAt} />
                  </TableCell>
                  <TableCell className="tabular-nums">{MetricFormat.bytes(size, locale)}</TableCell>
                  <TableCell className="pr-6">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="icon-sm"
                        variant="outline"
                        title={t("backups.download")}
                        aria-label={t("backups.downloadArchive", { archive })}
                        render={<a href={`/api/backups/${project}/${archive}`} download />}
                      >
                        <DownloadIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        title={t("backups.delete")}
                        aria-label={t("backups.deleteArchive", { archive })}
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
        title={t("backups.confirmTitle")}
        description={t("backups.confirmDescription")}
        confirmLabel={t("backups.delete")}
        destructive
        onConfirm={() => archiveToDelete && confirmDelete(archiveToDelete)}
        onCancel={() => setArchiveToDelete(null)}
      />

      {running && <AutoReload seconds={BackupsView.RunningReloadSeconds} />}
    </Card>
  );
}
