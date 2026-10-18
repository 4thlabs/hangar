import { DuplicatedJobError } from "sidequest";
import type { BackupConfig } from "#libs/hangar";

/** Where the backup runs go: Sidequest in production (`server/backup-queue.ts`), a double in the tests. */
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
}
