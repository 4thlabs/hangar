import type { Job, JobRun, JobState } from "#libs/api";
import { describeErrorDetail } from "#modules/common/helpers/error-message.ts";
import {
  settingsLabels,
  type JobKind,
  type JobOf,
  type JobWords,
  type JobWordsByKind,
} from "#modules/settings/helpers/settings-labels.ts";
import { m } from "#paraglide/messages.js";

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

/** A time of a run, in English. */
const runTimeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });

/** A job of the kind `Kind`, which ties its kind to its params for the table of words. */
type JobEntry<Kind extends JobKind = JobKind> = { [K in Kind]: JobOf<K> & { kind: K } }[Kind];

/** The words of `job`; for a kind this page does not know, from a newer server, its kind as the server gives it. */
export function jobWords(job: Job): JobWords {
  if (!Object.hasOwn(settingsLabels.jobs, job.kind)) {
    return {
      name: job.kind,
      runAgain: m.settings_jobs_run_again_unknown({ job: job.kind }),
      cancel: m.settings_jobs_cancel_unknown({ job: job.kind }),
    };
  }

  return wordsOfKind(job);
}

/** The name of `job`, as [`jobWords`](jobWords) gives it. */
export function jobName(job: Job): string {
  return jobWords(job).name;
}

/** The words of `job`, from the table of its kind. */
function wordsOfKind<Kind extends JobKind>(job: JobEntry<Kind>): JobWords {
  const words: JobWordsByKind = settingsLabels.jobs;

  return words[job.kind](job);
}

/** The label of `state`; the one the server gives for a state this page does not know. */
export function jobStateLabel(state: string): string {
  return Object.hasOwn(settingsLabels.jobStates, state) ? settingsLabels.jobStates[state as JobState]() : state;
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
export function askedAgainText(asked: JobRun): string {
  const job = jobName(asked.job);

  return asked.state === "running" ? m.settings_jobs_runs({ job }) : m.settings_jobs_waits({ job });
}
