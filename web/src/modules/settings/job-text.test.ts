import { describe, expect, it } from "vitest";
import type { JobRun } from "#libs/api";
import { JobText } from "#modules/settings/job-text.ts";

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

describe("JobText", () => {
  it("takes a run that waits or runs for one a cancel stops", () => {
    expect(JobText.isActive(run)).toBe(true);
    expect(JobText.isActive({ ...run, state: "running" })).toBe(true);
    expect(JobText.isActive({ ...run, state: "completed" })).toBe(false);
    expect(JobText.isActive({ ...run, state: "canceled" })).toBe(false);
  });

  it("says why a run failed, as the server says it", () => {
    const failed: JobRun = {
      ...run,
      state: "failed",
      error: { code: "docker.unavailable", message: "the Docker daemon could not be read. See the server's log." },
    };

    expect(JobText.failure(failed)).toBe("The Docker daemon could not be read. See the server's log.");
    expect(JobText.failure(run)).toBeUndefined();
  });

  it("says a time it has none of as a dash", () => {
    expect(JobText.time(null)).toBe("—");
    expect(JobText.time(run.createdAt)).toContain("2026");
  });

  it("names a job or a state it does not know, from a newer server, as the server does", () => {
    expect(JobText.name("image_check")).toBe("Image check");
    expect(JobText.name("backup")).toBe("backup");
    expect(JobText.state("paused")).toBe("paused");
  });

  it("says whether the job asked for again waits or runs", () => {
    expect(JobText.askedAgain(run)).toBe("Image check waits its turn.");
    expect(JobText.askedAgain({ ...run, job: "auto_update", state: "running" })).toBe("Update of the apps runs.");
  });
});
