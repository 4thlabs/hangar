import type { Job, JobState, SyncOperation } from "#libs/api";
import type { SettingsTabId } from "#modules/settings/helpers/settings-tab.ts";
import { m } from "#paraglide/messages.js";

/** The words of a sync of the store, of one operation. */
type SyncWords = {
  running: () => string;
  failed: (params: { reason: string }) => string;
  ended: () => string;
  endedAt: (params: { time: string }) => string;
  started: () => string;
};

/** A kind of the server's jobs, as `backup`. */
export type JobKind = Job["kind"];

/** The jobs of `Kind`, with their params. */
export type JobOf<Kind extends JobKind> = Extract<Job, { kind: Kind }>;

/** What the jobs' card says of a job: its name, and the labels of its buttons. */
export type JobWords = { name: string; runAgain: string; cancel: string };

/** The words of each kind of job, from the job, which carries its params. */
export type JobWordsByKind = { [Kind in JobKind]: (job: JobOf<Kind>) => JobWords };

/** The words of each value `settings` shows a label of, by the type that lists them: a new value is a type error here. */
export const settingsLabels = {
  /** What each tab is called. */
  tabs: {
    store: m.settings_tabs_store,
    env: m.settings_tabs_env,
    config: m.settings_tabs_config,
    jobs: m.settings_tabs_jobs,
  } satisfies Record<SettingsTabId, () => string>,
  /** What the store's card says of a sync, by its operation. */
  sync: {
    install: {
      running: m.settings_install_running,
      failed: m.settings_install_failed,
      ended: m.settings_install_ended,
      endedAt: m.settings_install_ended_at,
      started: m.settings_install_started,
    },
    update: {
      running: m.settings_update_running,
      failed: m.settings_update_failed,
      ended: m.settings_update_ended,
      endedAt: m.settings_update_ended_at,
      started: m.settings_update_started,
    },
  } satisfies Record<SyncOperation, SyncWords>,
  /** The words of each kind of job. */
  jobs: {
    image_check: () => ({
      name: m.settings_names_image_check(),
      runAgain: m.settings_jobs_run_again_image_check(),
      cancel: m.settings_jobs_cancel_image_check(),
    }),
    auto_update: () => ({
      name: m.settings_names_auto_update(),
      runAgain: m.settings_jobs_run_again_auto_update(),
      cancel: m.settings_jobs_cancel_auto_update(),
    }),
    backup: ({ params: { app } }) => ({
      name: m.settings_names_backup({ app }),
      runAgain: m.settings_jobs_run_again_backup({ app }),
      cancel: m.settings_jobs_cancel_backup({ app }),
    }),
  } satisfies JobWordsByKind,
  /** The label of each state of a job's run. */
  jobStates: {
    waiting: m.settings_states_waiting,
    running: m.settings_states_running,
    completed: m.settings_states_completed,
    failed: m.settings_states_failed,
    canceled: m.settings_states_canceled,
  } satisfies Record<JobState, () => string>,
};
