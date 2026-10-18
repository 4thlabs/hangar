import { DuplicatedJobError, ScheduledJobRegistry, Sidequest, type JobState } from "sidequest";
import type { BackupConfig } from "#libs/hangar";
import { BackupApp } from "../jobs/backup-app.ts";

/** Where the backup runs go: Sidequest in production, a double in the tests. */
export type BackupQueue = {
  /** Enqueues a run of `app` on every tick of `cron`, and returns the schedule's id */
  schedule(cron: string, app: string): Promise<string>;
  unschedule(scheduleId: string): Promise<void>;
  /** Rejects with a `DuplicatedJobError` while a run of `app` is waiting or running */
  enqueue(app: string): Promise<void>;
  /** How many runs of `app` are waiting or running */
  countActive(app: string): Promise<number>;
};

/** What a request for a backup did. */
export type BackupRequest = "enqueued" | "already-running";

/**
 * The backup runs of the apps hangar.yml declares: one schedule per app that has a `schedule`, kept
 * in step with the file, and the runs asked for by hand.
 *
 * Sidequest keeps its schedules in memory only, so they are registered once Sidequest has started,
 * and again whenever hangar.yml changes.
 */
export class BackupJobs {
  /** A queue of their own: a backup can take hours, and must not hold up the image checks */
  static readonly Queue = "backups";

  /**
   * Past it, the run is aborted. A run with no timeout is taken for stale after ten minutes and run
   * a second time, which a large app's backup would easily outlast.
   */
  private static readonly Timeout = 6 * 60 * 60 * 1_000;

  /** The states of a run still to finish */
  private static readonly ActiveStates: JobState[] = ["waiting", "claimed", "running"];

  private readonly queue: BackupQueue;

  /** The registered schedules, by app */
  private readonly schedules = new Map<string, { cron: string; scheduleId: string }>();

  /** Whether Sidequest has started: no schedule can be registered before */
  private started = false;

  /** The last synchronisation, so two never interleave */
  private synchronised: Promise<void> = Promise.resolve();

  /** @param queue Where the runs go */
  constructor(queue: BackupQueue) {
    this.queue = queue;
  }

  /**
   * Registers the schedules once Sidequest has started.
   * @param backups The backups hangar.yml declares
   */
  start(backups: BackupConfig[]) {
    this.started = true;

    return this.sync(backups);
  }

  /**
   * Brings the schedules in step with hangar.yml: registers the new ones, replaces the changed ones,
   * drops the ones it no longer declares. Does nothing before Sidequest has started.
   * @param backups The backups hangar.yml declares
   */
  sync(backups: BackupConfig[]): Promise<void> {
    const synchronised = this.synchronised.then(() => this.apply(backups));

    // The next synchronisation waits for this one, failed or not; the caller still gets its failure.
    this.synchronised = synchronised.catch(() => {});

    return synchronised;
  }

  /** Asks for a backup of `app` now, unless one is already waiting or running. */
  async request(app: string): Promise<BackupRequest> {
    try {
      await this.queue.enqueue(app);

      return "enqueued";
    } catch (error) {
      if (error instanceof DuplicatedJobError) {
        return "already-running";
      }

      throw error;
    }
  }

  /** Whether a backup of `app` is waiting or running; none can be before Sidequest has started. */
  async isActive(app: string) {
    if (!this.started) {
      return false;
    }

    return (await this.queue.countActive(app)) > 0;
  }

  private async apply(backups: BackupConfig[]) {
    if (!this.started) {
      return;
    }

    const wanted = new Map(
      backups.flatMap(backup => (backup.schedule === undefined ? [] : [[backup.app, backup.schedule] as const])),
    );

    for (const [app, { cron, scheduleId }] of this.schedules) {
      if (wanted.get(app) !== cron) {
        await this.queue.unschedule(scheduleId);
        this.schedules.delete(app);
      }
    }

    for (const [app, cron] of wanted) {
      if (!this.schedules.has(app)) {
        this.schedules.set(app, { cron, scheduleId: await this.queue.schedule(cron, app) });
      }
    }
  }

  /** The runs as Sidequest takes them: one at a time per app, never retried, aborted past the timeout. */
  static sidequest(): BackupQueue {
    // No `.with()`: it would replace the services the job builds by default. Unique by `[app]`,
    // so a run asked for by hand and a scheduled one never overlap.
    const builder = () =>
      Sidequest.build(BackupApp)
        .queue(BackupJobs.Queue)
        .unique({ withArgs: true })
        .maxAttempts(1)
        .timeout(BackupJobs.Timeout);

    return {
      schedule: async (cron, app) => (await builder().schedule(cron, app)).id,
      unschedule: async scheduleId => {
        await ScheduledJobRegistry.stop(scheduleId);
      },
      enqueue: async app => {
        await builder().enqueue(app);
      },
      countActive: async app => {
        const runs = await Sidequest.job.list({
          // Spelled out, as `ImageCheckReport` does: the bundle may rename the class.
          jobClass: "BackupApp",
          state: BackupJobs.ActiveStates,
          args: [app],
          limit: 1,
        });

        return runs.length;
      },
    };
  }
}

// Reused across HMR reloads, otherwise dev registers every schedule a second time
const globalForBackupJobs = globalThis as unknown as { backupJobs?: BackupJobs };

/** The backup runs of the web server, which owns the schedules. */
export const backupJobs = globalForBackupJobs.backupJobs ?? new BackupJobs(BackupJobs.sidequest());

globalForBackupJobs.backupJobs = backupJobs;
