import { plural, s } from "#modules/apps/format.ts";

/** The app's `backups` entry, as far as its page tells it. */
export type BackupSchedule = {
  /** `null` when the app is only backed up by hand */
  cron: string | null;
  keep: number;
  stop: boolean;
};

/** How the backups card shows an app's backups. */
export class BackupsView {
  /** While a backup runs, the page rereads the queue this often, so the new archive shows once done. */
  static readonly RunningReloadSeconds = 5;

  /** When an archive was made, in the browser's time zone. */
  static date(iso: string) {
    return new Date(iso).toLocaleString("fr-FR");
  }

  /**
   * One line on when and how the app is backed up.
   * @param schedule `null` when hangar.yml no longer declares a backup for the app
   */
  static summary(schedule: BackupSchedule | null) {
    if (!schedule) {
      return "hangar.yml ne déclare plus de sauvegarde pour cette application.";
    }

    const when = schedule.cron ? `Planifiée : ${schedule.cron}` : "Manuelle uniquement";
    const kept = `${plural(schedule.keep, "archive")} conservée${s(schedule.keep)}`;
    const stop = schedule.stop ? " · arrêtée pendant la sauvegarde" : "";

    return `${when} · ${kept}${stop}`;
  }
}
