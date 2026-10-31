import { backups } from "#libs/backups/server";
import { NotFoundError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { ServerTranslation } from "#libs/i18n/server";
import { backupJobs } from "#libs/jobs/server";
import { logger } from "#libs/logs";
import { backupApp, deleteBackup } from "#modules/apps/actions/manage-backups.ts";
import { AppBackupsCard } from "#modules/apps/components/app-backups-card.tsx";
import { AppsMessages } from "#modules/apps/messages.ts";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";

/**
 * Backups half of `/apps/[project]`, its own boundary: it reads the disk and the job queue, not
 * Docker, so it still shows when the daemon does not answer. Nothing to show for an app neither
 * declared in `backups` nor backed up before.
 */
export async function AppBackupsContent({ project }: { project: string }) {
  const config = hangar.store.config.backup(project);
  const { t } = ServerTranslation.get(AppsMessages);

  try {
    const [archives, running] = await Promise.all([backups.list(project), backupJobs.isActive(project)]);

    if (!config && archives.length === 0) {
      return null;
    }

    return (
      <AppBackupsCard
        project={project}
        schedule={config ? { cron: config.schedule ?? null, keep: config.keep, stop: config.stop } : null}
        archives={archives}
        running={running}
        backupApp={backupApp}
        deleteBackup={deleteBackup}
      />
    );
  } catch (error) {
    // A project name no app could have: there is nothing of it to list.
    if (error instanceof NotFoundError) {
      return null;
    }

    logger.error("Failed to list the backups", { error, project });

    return (
      <Alert variant="destructive">
        <AlertTitle>{t("backups.unavailableTitle")}</AlertTitle>
        <AlertDescription>{t("backups.unavailableDescription")}</AlertDescription>
      </Alert>
    );
  }
}
