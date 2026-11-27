import type { Job, JobState, SyncOperation } from "#libs/api";
import type { SettingsTabId } from "#modules/settings/helpers/settings-tab.ts";

/** What `settings` says: the settings page, its tabs and its cards. */
export const settingsMessages = {
  page: {
    documentTitle: "Settings | Hangar",
    title: "Settings",
    description: "Manage the configuration of your Hangar installation.",
  },
  tabs: {
    store: "Store",
    env: "Environment",
    config: "Configuration",
    jobs: "Jobs",
  } satisfies Record<SettingsTabId, string>,
  save: "Save",
  saving: "Saving…",
  store: {
    title: "STORE",
    description: "See the configured repository and synchronize its local copy.",
    readFailed: "Could not read the store",
    url: "Store URL",
    installed: "The store is installed locally.",
    notInstalled: "The store is not installed yet.",
    synchronizing: "Synchronizing…",
    install: "Install",
    update: "Update",
    syncStarted: "Synchronization started",
    launchFailed: "Launch failed",
    /** What the card says of a sync, by its operation. */
    sync: {
      install: {
        running: "Installing the store…",
        failed: ({ reason }: { reason: string }) => `The installation of the store failed: ${reason}`,
        ended: "The store was installed.",
        endedAt: ({ time }: { time: string }) => `The store was installed on ${time}.`,
        started: "The installation of the store was started.",
      },
      update: {
        running: "Updating the store…",
        failed: ({ reason }: { reason: string }) => `The update of the store failed: ${reason}`,
        ended: "The store was updated.",
        endedAt: ({ time }: { time: string }) => `The store was updated on ${time}.`,
        started: "The update of the store was started.",
      },
    } satisfies Record<SyncOperation, unknown>,
  },
  env: {
    title: "ENVIRONMENT",
    showFailed: "Could not show the environment",
    saved: "Environment saved",
    savedDescription: "The global environment was saved.",
    valuePlaceholder: "to fill in",
    showValue: ({ name }: { name: string }) => `Show the value of ${name}`,
    hideValue: ({ name }: { name: string }) => `Hide the value of ${name}`,
    generate: ({ name }: { name: string }) => `Generate a secret for ${name}`,
    remove: ({ name }: { name: string }) => `Remove ${name}`,
    newName: "Name of a new variable",
    newNamePlaceholder: "NEW_VARIABLE",
    add: "Add",
    toRemove: "To remove on save:",
    invalidName: ({ name }: { name: string }) => `Invalid variable name: ${name}.`,
    exists: ({ name }: { name: string }) => `${name} is set already.`,
  },
  config: {
    title: "CONFIGURATION",
    showFailed: "Could not show the configuration",
    saved: "Configuration saved",
    savedDescription: "The configuration was saved.",
  },
  jobs: {
    title: "JOBS",
    description:
      "The last 50 runs of the server's jobs: the image check, every four hours and as the server starts, and the update of the apps, every night.",
    readFailed: "Could not read the jobs",
    empty: "No jobs",
    emptyDescription: "No job has run since the server started.",
    columns: {
      job: "Job",
      queue: "Queue",
      state: "State",
      created: "Created",
      ended: "Ended",
      actions: "Actions",
    },
    runAgain: "Run again",
    runAgainLabel: ({ job }: { job: string }) => `Run the ${job.toLowerCase()} again`,
    cancel: "Cancel",
    cancelLabel: ({ job }: { job: string }) => `Cancel the ${job.toLowerCase()}`,
    askedAgain: "Job asked for again",
    runs: ({ job }: { job: string }) => `${job} runs.`,
    waits: ({ job }: { job: string }) => `${job} waits its turn.`,
    runAgainFailed: "Run again failed",
    canceled: "Job canceled",
    stops: ({ job }: { job: string }) => `${job} stops.`,
    cancelFailed: "Cancel failed",
    /** The name of each job. */
    names: {
      image_check: "Image check",
      auto_update: "Update of the apps",
    } satisfies Record<Job, string>,
    /** The label of each state. */
    states: {
      waiting: "Waiting",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      canceled: "Canceled",
    } satisfies Record<JobState, string>,
  },
} as const;
