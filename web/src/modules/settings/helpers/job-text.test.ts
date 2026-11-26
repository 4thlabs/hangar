import { describe, expect, it } from "vitest";
import type { JobRun } from "#libs/api";
import {
  askedAgainText,
  formatRunTime,
  isRunActive,
  jobName,
  jobsPollDelay,
  jobStateLabel,
  runFailure,
} from "#modules/settings/helpers/job-text.ts";

const run: JobRun = {
  id: 1,
  job: "image_check",
  queue: "default",
  state: "waiting",
  createdAt: "2026-11-26T12:17:00.000Z",
  startedAt: null,
  endedAt: null,
  error: null,
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

  it("reads the runs again each second while one waits or runs, every 30 seconds otherwise", () => {
    expect(jobsPollDelay([run])).toBe(1000);
    expect(jobsPollDelay([{ ...run, state: "completed" }])).toBe(30_000);
    expect(jobsPollDelay([])).toBe(30_000);
  });

  it("says a time it has none of as a dash", () => {
    expect(formatRunTime(null)).toBe("—");
    expect(formatRunTime(run.createdAt)).toContain("2026");
  });

  it("names a job or a state it does not know, from a newer server, as the server does", () => {
    expect(jobName("image_check")).toBe("Image check");
    expect(jobName("backup")).toBe("backup");
    expect(jobStateLabel("paused")).toBe("paused");
  });

  it("says whether the job asked for again waits or runs", () => {
    expect(askedAgainText(run)).toBe("Image check waits its turn.");
    expect(askedAgainText({ ...run, job: "auto_update", state: "running" })).toBe("Update of the apps runs.");
  });
});
