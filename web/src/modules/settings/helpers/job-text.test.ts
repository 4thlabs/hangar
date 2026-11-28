import { describe, expect, it } from "vitest";
import type { Job, JobRun } from "#libs/api";
import {
  askedAgainText,
  formatRunTime,
  isRunActive,
  jobName,
  jobsPollDelay,
  jobStateLabel,
  jobWords,
  runFailure,
  runResult,
} from "#modules/settings/helpers/job-text.ts";

const run: JobRun = {
  id: 1,
  job: { kind: "image_check" },
  queue: "default",
  state: "waiting",
  createdAt: "2026-11-26T12:17:00.000Z",
  startedAt: null,
  endedAt: null,
  error: null,
  result: null,
};

describe("the jobs' words", () => {
  it("takes a run that waits or runs for one a cancel stops", () => {
    expect(isRunActive(run)).toBe(true);
    expect(isRunActive({ ...run, state: "running" })).toBe(true);
    expect(isRunActive({ ...run, state: "completed" })).toBe(false);
    expect(isRunActive({ ...run, state: "canceled" })).toBe(false);
  });

  it("says why a run failed, as the server says it", () => {
    const failed: JobRun = {
      ...run,
      state: "failed",
      error: { code: "docker.unavailable", message: "the Docker daemon could not be read. See the server's log." },
    };

    expect(runFailure(failed)).toBe("The Docker daemon could not be read. See the server's log.");
    expect(runFailure(run)).toBeUndefined();
  });

  it("says what the update of the apps did: the apps it updated, failed for and skipped", () => {
    const update: JobRun = { ...run, job: { kind: "auto_update" }, state: "completed" };

    const did = (updated: string[], failed: string[], skipped: string[]): JobRun => ({
      ...update,
      result: { kind: "auto_update", params: { updated, failed, skipped } },
    });

    expect(runResult(did(["gamma", "epsilon"], [], ["alpha"]))).toEqual([
      "Updated: gamma and epsilon.",
      "Skipped, as another command held them: alpha.",
    ]);

    expect(runResult(did([], ["gamma"], []))).toEqual(["Failed: gamma."]);
    expect(runResult(did([], [], []))).toEqual(["No app had an update."]);
    expect(runResult(update)).toEqual([]);
  });

  it("says no app had an update only of a run that completed", () => {
    const canceled: JobRun = {
      ...run,
      job: { kind: "auto_update" },
      state: "canceled",
      result: { kind: "auto_update", params: { updated: [], failed: [], skipped: [] } },
    };

    expect(runResult(canceled)).toEqual([]);
    expect(
      runResult({
        ...canceled,
        result: { kind: "auto_update", params: { updated: ["gamma"], failed: [], skipped: [] } },
      }),
    ).toEqual(["Updated: gamma."]);
  });

  it("says nothing of what a newer server says a run did that it does not know", () => {
    // What a newer server may send, which the contract of this page does not have.
    const newer = { ...run, result: { kind: "prune", params: { removed: 3 } } } as unknown as JobRun;

    expect(runResult(newer)).toEqual([]);
  });

  it("reads the runs again each second while one waits or runs, every 30 seconds otherwise", () => {
    expect(jobsPollDelay([run])).toBe(1000);
    expect(jobsPollDelay([{ ...run, state: "completed" }])).toBe(30_000);
    expect(jobsPollDelay([])).toBe(30_000);
  });

  it("says a time it has none of as a dash", () => {
    expect(formatRunTime(null)).toBe("—");
    expect(formatRunTime(run.createdAt)).toContain("2026");
  });

  it("names each job, a backup by its app", () => {
    expect(jobName({ kind: "image_check" })).toBe("Image check");
    expect(jobWords({ kind: "backup", params: { app: "alpha" } })).toEqual({
      name: "Backup of alpha",
      runAgain: "Run the backup of alpha again",
      cancel: "Cancel the backup of alpha",
    });
  });

  it("names a job or a state it does not know, from a newer server, as the server does", () => {
    // What a newer server may send, which the contract of this page does not have.
    const newer = { kind: "prune" } as unknown as Job;

    expect(jobWords(newer)).toEqual({ name: "prune", runAgain: "Run the prune again", cancel: "Cancel the prune" });
    expect(jobStateLabel("paused")).toBe("paused");
  });

  it("says whether the job asked for again waits or runs", () => {
    expect(askedAgainText(run)).toBe("Image check waits its turn.");
    expect(askedAgainText({ ...run, job: { kind: "auto_update" }, state: "running" })).toBe("Update of the apps runs.");
  });
});
