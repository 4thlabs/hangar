import "server-only";
import { ScheduledJobRegistry, Sidequest, type JobState } from "sidequest";
import { BackupJobs, type BackupQueue } from "../backup-jobs.ts";
import { BackupApp } from "../jobs/backup-app.ts";

/** The backup runs as Sidequest takes them: one at a time per app, never retried, aborted past the timeout. */
export class SidequestBackupQueue implements BackupQueue {
  /** A queue of their own: a backup can take hours, and must not hold up the image checks */
  static readonly Name = "backups";

  /**
   * Past it, the run is aborted. A run with no timeout is taken for stale after ten minutes and run
   * a second time, which a large app's backup would easily outlast.
   */
  private static readonly Timeout = 6 * 60 * 60 * 1_000;

  /** The states of a run still to finish */
  private static readonly ActiveStates: JobState[] = ["waiting", "claimed", "running"];

  async schedule(cron: string, app: string) {
    const task = await SidequestBackupQueue.builder().schedule(cron, app);

    return task.id;
  }

  async unschedule(scheduleId: string) {
    await ScheduledJobRegistry.stop(scheduleId);
  }

  async enqueue(app: string) {
    await SidequestBackupQueue.builder().enqueue(app);
  }

  async countActive(app: string) {
    const runs = await Sidequest.job.list({
      // Spelled out, as `ImageCheckReport` does: the bundle may rename the class.
      jobClass: "BackupApp",
      state: SidequestBackupQueue.ActiveStates,
      args: [app],
      limit: 1,
    });

    return runs.length;
  }

  /**
   * No `.with()`: it would replace the services the job builds by default. Unique by `[app]`, so a
   * run asked for by hand and a scheduled one never overlap.
   */
  private static builder() {
    return Sidequest.build(BackupApp)
      .queue(SidequestBackupQueue.Name)
      .unique({ withArgs: true })
      .maxAttempts(1)
      .timeout(SidequestBackupQueue.Timeout);
  }
}

// Reused across HMR reloads, otherwise dev registers every schedule a second time
const globalForBackupJobs = globalThis as unknown as { backupJobs?: BackupJobs };

/** The backup runs of the web server, which owns the schedules. */
export const backupJobs = globalForBackupJobs.backupJobs ?? new BackupJobs(new SidequestBackupQueue());

globalForBackupJobs.backupJobs = backupJobs;
