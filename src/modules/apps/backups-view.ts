import type { Translate } from "#libs/i18n";
import type { AppsMessages } from "#modules/apps/messages.ts";

/** The app's `backups` entry, as far as its page tells it. */
export type BackupSchedule = {
  /** `null` when the app is only backed up by hand */
  cron: string | null;
  keep: number;
  stop: boolean;
};

/** How the backups card shows an app's backups. */
export class BackupsView {
  /**
   * While a backup runs, the page rereads the queue this often, so the new archive shows once done. The
   * whole route rerenders, Docker's half included, for as long as the backup lasts: not too often.
   */
  static readonly RunningReloadSeconds = 15;

  /**
   * One line on when and how the app is backed up.
   * @param schedule `null` when hangar.yml no longer declares a backup for the app
   */
  static summary(schedule: BackupSchedule | null, t: Translate<typeof AppsMessages.en>) {
    if (!schedule) {
      return t("backups.undeclared");
    }

    const when = schedule.cron ? t("backups.scheduled", { cron: schedule.cron }) : t("backups.manualOnly");
    const kept = t("backups.kept", { count: schedule.keep });
    const stop = schedule.stop ? ` · ${t("backups.stopped")}` : "";

    return `${when} · ${kept}${stop}`;
  }
}
