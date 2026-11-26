import type { Job, JobRun, JobState } from "#libs/api";
import { describeErrorDetail } from "#modules/common/error-message.ts";

// What the jobs' card says of the server's jobs and their runs.

/** How often the card reads the runs again while one waits or runs, in milliseconds. */
export const jobsPollMs = 1000;

/**
 * How often the card reads the runs again while none waits or runs, in milliseconds: a run a cron asks for, or
 * another page, shows within it.
 */
export const jobsIdlePollMs = 30_000;

/** How long the card waits before it reads `runs` again, in milliseconds. */
export function jobsPollDelay(runs: readonly JobRun[]): number {
  return runs.some(isRunActive) ? jobsPollMs : jobsIdlePollMs;
}

/** The name of each job. */
export const jobNames: Readonly<Record<Job, string>> = {
  image_check: "Image check",
  auto_update: "Update of the apps",
};

/** The label of each state. */
export const jobStateLabels: Readonly<Record<JobState, string>> = {
  waiting: "Waiting",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};

/** A time of a run, in English. */
const runTimeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });

/** The name of `job`; the one the server gives for a job this page does not know, from a newer server. */
export function jobName(job: string): string {
  return Object.hasOwn(jobNames, job) ? jobNames[job as Job] : job;
}

/** The label of `state`; the one the server gives for a state this page does not know. */
export function jobStateLabel(state: string): string {
  return Object.hasOwn(jobStateLabels, state) ? jobStateLabels[state as JobState] : state;
}

/** Whether `run` still waits or runs, which a cancel stops. */
export function isRunActive(run: JobRun): boolean {
  return run.state === "waiting" || run.state === "running";
}

/** `time`, a time of the server in RFC 3339, in English; a dash for none. */
export function formatRunTime(time: string | null): string {
  return time === null ? "—" : runTimeFormat.format(new Date(time));
}

/** Why `run` failed, as the server says it; nothing for a run that did not. */
export function runFailure(run: JobRun): string | undefined {
  return run.error ? describeErrorDetail(run.error) : undefined;
}

/** What the toast of a job asked for again says: its run waits its turn, or already runs. */
export function askedAgain(asked: JobRun): string {
  const name = jobName(asked.job);

  return asked.state === "running" ? `${name} runs.` : `${name} waits its turn.`;
}
