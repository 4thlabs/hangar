import type { ContainerHealth, ContainerState, ProjectStatus } from "#libs/api";
import type { AppUpdate } from "#modules/apps/helpers/apps-search.ts";
import type { AppRunStatus } from "#modules/apps/helpers/compose-output.ts";
import type { StreamStatus } from "#modules/common/hooks/use-event-stream.ts";
import { commonMessages } from "#modules/common/messages.ts";

/** "container" for one, "containers" for any other count. */
function containers(count: number): string {
  return count === 1 ? "container" : "containers";
}

/** What `apps` says: the apps' pages, their tables, their compose commands and their logs. */
export const appsMessages = {
  /** What each status is called, as the Waku version calls it. */
  status: {
    running: "Running",
    partial: "Partial",
    stopped: "Stopped",
    unhealthy: "Degraded",
  } satisfies Record<ProjectStatus, string>,
  /** What a healthcheck's word is. */
  health: {
    healthy: "Healthy",
    unhealthy: "Unhealthy",
    starting: "Starting",
  } satisfies Record<ContainerHealth, string>,
  /** What each state of a container is called. */
  containerState: {
    created: "Created",
    running: "Running",
    paused: "Paused",
    restarting: "Restarting",
    exited: "Exited",
    removing: "Removing",
    dead: "Dead",
    unknown: "Unknown",
  } satisfies Record<ContainerState, string>,
  /** What the update filter's menu calls each side. */
  update: {
    available: "Available",
    current: "Up to date",
  } satisfies Record<AppUpdate, string>,
  filters: {
    category: "Category",
    status: "Status",
    update: "Update",
  },
  list: {
    documentTitle: "Apps | Hangar",
    title: "Apps",
    description: "Apps installed by Hangar and their Docker state.",
    readFailed: "Could not read the apps",
    reading: "Reading Docker…",
    noSelection: "No selection",
    selected: ({ count }: { count: number }) => `${commonMessages.compose.appCount({ count })} selected`,
    noResults: "No results",
    noResultsDescription: "No app matches this search.",
    noApps: "No apps installed",
    noAppsDescription: "Install an app from the store to find it here.",
    totals: {
      apps: "Apps",
      services: "Services",
      runningContainers: "Running containers",
      notRunning: "Not running",
      cpu: "CPU",
      memory: "Memory",
      allApps: "All apps combined",
    },
  },
  table: {
    selectAll: "Select all",
    select: ({ name }: { name: string }) => `Select ${name}`,
    app: "App",
    category: "Category",
    status: "Status",
    services: "Services",
    containers: "Containers",
    unhealthy: "Unhealthy",
    update: "Update",
  },
  detail: {
    documentTitle: ({ project }: { project: string }) => `${project} | Apps | Hangar`,
    allApps: "← All apps",
    readFailed: "Could not read this app",
    reading: "Reading Docker…",
    notFound: "App not found",
    notFoundDescription: ({ project }: { project: string }) => `No installed app is called “${project}”.`,
    backToApps: "Back to apps",
    updateAvailable: "Update available",
    services: ({ count }: { count: number }) => `${count} ${count === 1 ? "service" : "services"}`,
    containersRunning: ({ running, total }: { running: number; total: number }) =>
      `${running}/${total} ${containers(total)} running`,
    stats: {
      cpu: "CPU",
      runningSum: "Sum of the running containers",
      memory: "Memory",
      onTheHost: ({ bytes }: { bytes: string }) => `${bytes} on the host`,
      available: ({ bytes }: { bytes: string }) => `${bytes} available`,
      network: "Network",
      disk: "Disk",
    },
  },
  service: {
    running: ({ running, total }: { running: number; total: number }) =>
      `${running}/${total} ${containers(total)} running`,
    unhealthy: ({ count }: { count: number }) => `${count} unhealthy`,
  },
  containers: {
    container: "Container",
    state: "State",
    image: "Image",
    ports: "Ports",
    cpu: "CPU",
    memory: "Memory",
    network: "Network",
    disk: "Disk",
    restarts: "Restarts",
    logs: "Logs",
    memoryUsedBy: ({ name }: { name: string }) => `Memory used by ${name}`,
  },
  compose: {
    upLabel: ({ commandLine }: { commandLine: string }) => `Up: ${commandLine}`,
    upOptions: "Up options",
    runsOn: ({ label, subject }: { label: string; subject: string }) => `${label} runs on ${subject}:`,
    showOutput: "Show output",
    /** What the panel says of each state of the stream. */
    streamStatus: {
      connecting: "Connecting…",
      connected: "Live",
      ended: "Done",
      error: "Error",
    } satisfies Record<StreamStatus, string>,
    /** What the panel says of each state of an app's run. */
    runStatus: {
      waiting: "Waiting",
      running: "Running",
      succeeded: "Succeeded",
      failed: "Failed",
      not_run: "Not run",
    } satisfies Record<AppRunStatus, string>,
    closingInterruptsNothing:
      "Closing this panel interrupts nothing: the command runs to its end on the server, and each app files a notification.",
    skipped: ({ count }: { count: number }) =>
      `The start of the output is no longer kept: ${count} earlier ${count === 1 ? "event is" : "events are"} left out.`,
    /** What the panel says of a stream that ended before its `end`. */
    cutShort: "The output was cut short: the command goes on on the server.",
  },
  logs: {
    open: ({ name }: { name: string }) => `View the logs of ${name}`,
    button: "Logs",
    title: ({ name }: { name: string }) => `Logs of ${name}`,
    tail: "last 200 lines, then followed live",
    /** What the badge of each state of a followed log says. */
    status: {
      connecting: "Connecting…",
      connected: "Live",
      ended: "Stream ended",
      error: "Error",
    } satisfies Record<StreamStatus, string>,
    reconnect: "Reconnect",
    clear: "Clear",
    resume: "Resume following",
    waiting: "Waiting for logs…",
  },
  reconnecting: "Reconnecting to the server: what this page shows may be out of date.",
} as const;
