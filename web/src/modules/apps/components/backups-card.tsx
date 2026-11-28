import { useMutation, useQuery } from "@tanstack/react-query";
import { ArchiveIcon, DownloadIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import type { BackupStatus } from "#libs/api";
import { backupArchiveUrl, backupsMutations, backupsQueries } from "#modules/apps/api/backups-queries.ts";
import { backupPlanParts, formatArchiveTime, hasBackups } from "#modules/apps/helpers/backup-status.ts";
import { formatBytes } from "#modules/apps/helpers/metric-format.ts";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { QueryRegion } from "#modules/common/components/region.tsx";
import { toastFailure, toastSuccess } from "#modules/common/components/toast.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Skeleton } from "#modules/common/ui/skeleton.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";
import { m } from "#paraglide/messages.js";

/**
 * The backups of `project`, a card of its own: it reads the disk and the jobs, not Docker, so it shows when the daemon
 * does not answer. Nothing for an app `hangar.yml` does not back up and that has no archive left.
 */
export function BackupsCard({ project }: { project: string }) {
  const backups = useQuery(backupsQueries.status(project));

  return (
    <QueryRegion query={backups} failure={m.apps_backups_read_failed()} fallback={<Skeleton className="h-24 w-full" />}>
      {status => hasBackups(status) && <AppBackups project={project} status={status} error={backups.error} />}
    </QueryRegion>
  );
}

type AppBackupsProps = {
  project: string;
  status: BackupStatus;
  /** Why the last read failed, when what is shown is an earlier read. */
  error: Error | null;
};

/** The backups once read: when the app is backed up, its button, and its archives to download or delete. */
function AppBackups({ project, status, error }: AppBackupsProps) {
  const [archiveToDelete, setArchiveToDelete] = useState<string | null>(null);

  // The options read the backups again whatever the outcome; the toasts are this card's.
  const backUp = useMutation({
    ...backupsMutations.backUp(),
    onSuccess: () => toastSuccess(m.apps_backups_started(), m.apps_backups_launched({ app: project })),
    onError: failure => toastFailure(m.apps_backups_start_failed(), failure),
  });

  const remove = useMutation({
    ...backupsMutations.remove(),
    onSuccess: () => toastSuccess(m.apps_backups_deleted(), m.apps_backups_archive_deleted()),
    onError: failure => toastFailure(m.apps_backups_delete_failed(), failure),
  });

  const isRunning = status.run !== null;

  const confirmDelete = (archive: string) => {
    setArchiveToDelete(null);
    remove.mutate({ app: project, archive });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.apps_backups_title()}</CardTitle>
        <CardDescription>{backupPlanParts(status.plan).join(" · ")}</CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            disabled={status.plan === null || isRunning || backUp.isPending}
            onClick={() => backUp.mutate({ app: project })}
          >
            {isRunning ? <Spinner /> : <ArchiveIcon />}
            {isRunning ? m.apps_backups_running() : m.apps_backups_back_up_now()}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className={status.archives.length > 0 ? "px-0" : undefined}>
        {error && <p className="px-6 pb-2 text-sm text-destructive">{describeError(error)}</p>}
        {status.archives.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.apps_backups_none()}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">{m.apps_backups_date()}</TableHead>
                <TableHead>{m.apps_backups_size()}</TableHead>
                <TableHead className="pr-6 text-right">{m.apps_backups_actions()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.archives.map(({ name, size, createdAt }) => (
                <TableRow key={name}>
                  <TableCell className="pl-6">{formatArchiveTime(createdAt)}</TableCell>
                  <TableCell className="tabular-nums">{formatBytes(size)}</TableCell>
                  <TableCell className="pr-6">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="icon-sm"
                        variant="outline"
                        title={m.apps_backups_download()}
                        aria-label={m.apps_backups_download_archive({ archive: name })}
                        render={<a href={backupArchiveUrl(project, name)} download />}
                      >
                        <DownloadIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        title={m.apps_backups_delete()}
                        aria-label={m.apps_backups_delete_archive({ archive: name })}
                        disabled={remove.isPending}
                        onClick={() => setArchiveToDelete(name)}
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
        title={m.apps_backups_confirm_title()}
        description={m.apps_backups_confirm_description()}
        confirmLabel={m.apps_backups_delete()}
        destructive
        onConfirm={() => archiveToDelete !== null && confirmDelete(archiveToDelete)}
        onCancel={() => setArchiveToDelete(null)}
      />
    </Card>
  );
}
