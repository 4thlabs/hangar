import type { BackupPlan, BackupStatus } from "#libs/api";
import { m } from "#paraglide/messages.js";

// What an app's page says of its backups.

/** How often the backups are read again while a run of the app's backup waits or runs, in milliseconds. */
export const backupsPollMs = 2000;

/** A time of an archive, in English. */
const archiveTimeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });

/** How long the page waits before it reads `status` again, in milliseconds; not at all while no backup waits or runs. */
export function backupsPollDelay(status: BackupStatus | undefined): number | false {
  return status?.run ? backupsPollMs : false;
}

/** Whether the page shows the backups of `status`: those `hangar.yml` declares, or the archives an older one left. */
export function hasBackups(status: BackupStatus): boolean {
  return status.plan !== null || status.archives.length > 0;
}

/** What the page says of `plan`, in parts: when the app is backed up, how many archives are kept, and its stop. */
export function backupPlanParts(plan: BackupPlan | null): string[] {
  if (plan === null) {
    return [m.apps_backups_undeclared()];
  }

  const when =
    plan.schedule === null ? m.apps_backups_manual_only() : m.apps_backups_scheduled({ cron: plan.schedule });

  const kept = m.apps_backups_kept({ count: plan.keep });

  return plan.stop ? [when, kept, m.apps_backups_stopped()] : [when, kept];
}

/** `time`, an archive's in RFC 3339, in English. */
export function formatArchiveTime(time: string): string {
  return archiveTimeFormat.format(new Date(time));
}
