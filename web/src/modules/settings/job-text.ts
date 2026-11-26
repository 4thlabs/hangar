import type { Job, JobRun, JobState } from "#libs/api";
import { ErrorMessage } from "#modules/common/error-message.ts";

/** What the jobs' card says of the server's jobs and their runs. */
export class JobText {
  /** How often the card reads the runs again while one waits or runs, in milliseconds. */
  static readonly PollMs = 1000;

  /** The name of each job. */
  static readonly Names: Readonly<Record<Job, string>> = {
    image_check: "Image check",
    auto_update: "Update of the apps",
  };

  /** The label of each state. */
  static readonly States: Readonly<Record<JobState, string>> = {
    waiting: "Waiting",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    canceled: "Canceled",
  };

  /** A time of a run, in English. */
  private static readonly Time = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });

  /** Whether `run` still waits or runs, which a cancel stops. */
  static isActive(run: JobRun): boolean {
    return run.state === "waiting" || run.state === "running";
  }

  /** `time`, a time of the server in RFC 3339, in English; a dash for none. */
  static time(time: string | null): string {
    return time === null ? "—" : JobText.Time.format(new Date(time));
  }

  /** Why `run` failed, as the server says it; nothing for a run that did not. */
  static failure(run: JobRun): string | undefined {
    return run.error ? ErrorMessage.describeDetail(run.error) : undefined;
  }

  /** What the toast of a job asked for again says: its run waits its turn, or already runs. */
  static askedAgain(asked: JobRun): string {
    const name = JobText.Names[asked.job];

    return asked.state === "running" ? `${name} runs.` : `${name} waits its turn.`;
  }
}
