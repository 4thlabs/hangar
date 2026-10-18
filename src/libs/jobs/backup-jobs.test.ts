import { DuplicatedJobError, type JobData } from "sidequest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupConfig } from "#libs/hangar";
import { BackupJobs, type BackupQueue } from "./backup-jobs.ts";

const queue = {
  schedule: vi.fn<BackupQueue["schedule"]>(),
  unschedule: vi.fn<BackupQueue["unschedule"]>(),
  enqueue: vi.fn<BackupQueue["enqueue"]>(),
  countActive: vi.fn<BackupQueue["countActive"]>(),
} satisfies BackupQueue;

/** A backup as hangar.yml declares it once defaulted. */
function backupOf(app: string, schedule?: string): BackupConfig {
  return { app, schedule, keep: 7, stop: false, include: ["**"], exclude: [] };
}

describe("BackupJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queue.schedule.mockImplementation(async (cron, app) => `${app}@${cron}`);
  });

  it("registers nothing before Sidequest has started, then the scheduled backups", async () => {
    const jobs = new BackupJobs(queue);

    await jobs.sync([backupOf("jellyfin", "30 3 * * *")]);

    expect(queue.schedule).not.toHaveBeenCalled();

    await jobs.start([backupOf("jellyfin", "30 3 * * *"), backupOf("immich")]);

    expect(queue.schedule.mock.calls).toEqual([["30 3 * * *", "jellyfin"]]);
  });

  it("adds, replaces and drops schedules as hangar.yml changes, leaving the unchanged ones", async () => {
    const jobs = new BackupJobs(queue);

    await jobs.start([
      backupOf("jellyfin", "30 3 * * *"),
      backupOf("immich", "0 4 * * *"),
      backupOf("miniflux", "0 5 * * *"),
    ]);

    vi.clearAllMocks();

    await jobs.sync([
      backupOf("jellyfin", "30 3 * * *"),
      backupOf("immich", "0 2 * * *"),
      backupOf("frigate", "0 1 * * *"),
    ]);

    expect(queue.unschedule.mock.calls).toEqual([["immich@0 4 * * *"], ["miniflux@0 5 * * *"]]);
    expect(queue.schedule.mock.calls).toEqual([
      ["0 2 * * *", "immich"],
      ["0 1 * * *", "frigate"],
    ]);
  });

  it("drops the schedule of a backup left to be run by hand", async () => {
    const jobs = new BackupJobs(queue);

    await jobs.start([backupOf("jellyfin", "30 3 * * *")]);
    await jobs.sync([backupOf("jellyfin")]);

    expect(queue.unschedule).toHaveBeenCalledWith("jellyfin@30 3 * * *");
  });

  it("runs one synchronisation after the other, even after a failed one", async () => {
    const jobs = new BackupJobs(queue);

    queue.schedule.mockRejectedValueOnce(new Error("registry down"));

    const failed = jobs.start([backupOf("jellyfin", "30 3 * * *")]);
    const next = jobs.sync([backupOf("jellyfin", "30 3 * * *")]);

    await expect(failed).rejects.toThrow("registry down");
    await next;

    expect(queue.schedule).toHaveBeenCalledTimes(2);
  });

  it("asks for a backup, and says when one is already waiting or running", async () => {
    const jobs = new BackupJobs(queue);

    queue.enqueue.mockResolvedValueOnce(undefined);
    queue.enqueue.mockRejectedValueOnce(new DuplicatedJobError({ class: "BackupApp", args: ["jellyfin"] } as JobData));

    expect(await jobs.request("jellyfin")).toBe("enqueued");
    expect(await jobs.request("jellyfin")).toBe("already-running");
  });

  it("knows of no running backup before Sidequest has started", async () => {
    const jobs = new BackupJobs(queue);

    queue.countActive.mockResolvedValue(1);

    expect(await jobs.isActive("jellyfin")).toBe(false);

    await jobs.start([]);

    expect(await jobs.isActive("jellyfin")).toBe(true);
  });
});
