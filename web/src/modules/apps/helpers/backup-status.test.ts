import { describe, expect, it } from "vitest";
import type { BackupStatus, JobRun } from "#libs/api";
import { backupPlanParts, backupsPollDelay, hasBackups } from "#modules/apps/helpers/backup-status.ts";

const status: BackupStatus = { plan: { schedule: null, keep: 1, stop: false }, archives: [], run: null };

const run: JobRun = {
  id: 1,
  job: { kind: "backup", params: { app: "alpha" } },
  queue: "backups",
  state: "running",
  createdAt: "2026-11-28T09:00:00.000Z",
  startedAt: "2026-11-28T09:00:00.000Z",
  endedAt: null,
  error: null,
  result: null,
};

describe("the backups of an app's page", () => {
  it("says when and how an app is backed up, and an app no longer backed up", () => {
    expect(backupPlanParts(status.plan)).toEqual(["Manual only", "1 archive kept"]);
    expect(backupPlanParts({ schedule: "0 3 * * *", keep: 14, stop: true })).toEqual([
      "Scheduled: 0 3 * * *",
      "14 archives kept",
      "stopped during the backup",
    ]);

    expect(backupPlanParts(null)).toEqual(["hangar.yml no longer declares a backup for this app."]);
  });

  it("shows the backups an app declares, or the archives it left", () => {
    expect(hasBackups(status)).toBe(true);
    expect(hasBackups({ ...status, plan: null })).toBe(false);
    expect(
      hasBackups({ ...status, plan: null, archives: [{ name: "a", size: 1, createdAt: "2026-11-28T09:00:00Z" }] }),
    ).toBe(true);
  });

  it("reads the backups again while one waits or runs, and not otherwise", () => {
    expect(backupsPollDelay({ ...status, run })).toBe(2000);
    expect(backupsPollDelay(status)).toBe(false);
    expect(backupsPollDelay(undefined)).toBe(false);
  });
});
