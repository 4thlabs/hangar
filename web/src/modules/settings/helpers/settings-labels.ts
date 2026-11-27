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
  /** The name of each job. */
  jobNames: {
    image_check: m.settings_names_image_check,
    auto_update: m.settings_names_auto_update,
  } satisfies Record<Job, () => string>,
  /** The label of each state of a job's run. */
  jobStates: {
    waiting: m.settings_states_waiting,
    running: m.settings_states_running,
    completed: m.settings_states_completed,
    failed: m.settings_states_failed,
    canceled: m.settings_states_canceled,
  } satisfies Record<JobState, () => string>,
};
