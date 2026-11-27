import type { ComposeOperation } from "#modules/common/helpers/compose-actions.ts";

/** "these apps" or "this app", as a confirmation names the apps it is about. */
function theseApps(count: number): string {
  return count > 1 ? "these apps" : "this app";
}

/** `text` with a capital first letter. */
function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** What `common` says: the shell, the shared components, the compose commands and the server's errors. */
export const commonMessages = {
  shell: {
    homeLink: "Hangar — Dashboard",
    mainNavigation: "Main navigation",
    navigation: {
      general: "General",
      dashboard: "Dashboard",
      apps: "Apps",
      cluster: "Cluster",
      store: "Store",
      administration: "Administration",
      settings: "Settings",
    },
    search: "Search",
    searchPlaceholder: "Search…",
    searchUnavailable: "Search unavailable here",
    openSearch: "Open search",
    closeSearch: "Close search",
    userMenu: ({ name }: { name: string }) => `User menu of ${name}`,
    signOut: "Sign out",
    signingOut: "Signing out…",
    signOutFailed: "Could not sign you out. Try again.",
    errorPage: {
      title: "Could not open this page",
      retry: "Try again",
    },
    notFound: {
      title: "Page not found",
      description: "Nothing lives at this address.",
      back: "Back to the dashboard",
    },
    pending: {
      title: "Not here yet",
      description: "This page is still served by the current version of Hangar.",
    },
  },
  clearFilters: "Clear all",
  confirm: "Confirm",
  cancel: "Cancel",
  retry: "Retry",
  compose: {
    upFlags: {
      pull: {
        label: "Update the images",
        verb: "Update",
        outcome: "updated from its registry",
        consequence: () => "The images will be pulled from the registry and the containers recreated.",
      },
      forceRecreate: {
        label: "Force recreation",
        verb: "Recreate",
        outcome: "recreated",
        consequence: ({ count }: { count: number }) =>
          `Every container of ${theseApps(count)} will be recreated, even if its configuration did not change.`,
      },
    },
    operations: {
      up: "Up",
      restart: "Restart",
      down: "Down",
    } satisfies Record<ComposeOperation, string>,
    /** What each run without options did to an app, completing "<app> was …". */
    outcomes: {
      up: "started or updated",
      restart: "restarted",
      down: "stopped and removed",
    } satisfies Record<ComposeOperation, string>,
    outcome: ({ project, outcomes }: { project: string; outcomes: readonly string[] }) =>
      `${project} was ${outcomes.join(" and ")}.`,
    combinedLabel: ({ verbs }: { verbs: readonly string[] }) =>
      capitalized(verbs.map(verb => verb.toLowerCase()).join(" and ")),
    appCount: ({ count }: { count: number }) => `${count} ${count === 1 ? "app" : "apps"}`,
    stopTitle: ({ subject }: { subject: string }) => `Stop ${subject}?`,
    confirmTitle: ({ label, subject }: { label: string; subject: string }) => `${label} ${subject}?`,
    downDescription: ({ count }: { count: number }) =>
      `Docker Compose will remove the containers and networks of ${theseApps(count)}. ${count > 1 ? "They stay listed" : "It stays listed"}, stopped.`,
    restartDescription: ({ count }: { count: number }) =>
      `The containers of ${theseApps(count)} will be restarted without being recreated: a changed configuration will not apply.`,
  },
  errors: {
    serverUnreachable: "Could not reach the server. Try again.",
    logHint: "See the server's log.",
    store: {
      unknownApp: ({ app }: { app: string }) => `The store has no app ${app}.`,
      appsUnreadable: "The store's apps could not be read.",
      installFailed: ({ app }: { app: string }) => `The installation of ${app} failed.`,
      uninstallFailed: ({ app }: { app: string }) => `The uninstallation of ${app} failed.`,
      cloneFailed: "The store could not be cloned.",
      pullFailed: "The store could not be pulled.",
      notInstalled: "The store is not installed: install it from the settings first.",
      syncRunning: "The store is being synced: try again once its sync has ended.",
      syncCrashed: "The sync of the store stopped short.",
      batchRunning: ({ apps }: { apps: readonly string[] }) =>
        `Compose commands run on ${apps.join(", ")}: sync the store once they have ended.`,
    },
    config: {
      syntax: ({ reason }: { reason: string }) => `hangar.yml is not valid YAML: ${reason}`,
      invalid: ({ field, reason }: { field: string; reason: string }) => `Invalid hangar.yml: ${field}: ${reason}`,
      unreadable: "hangar.yml could not be read.",
      saveFailed: "hangar.yml could not be saved.",
    },
    env: {
      invalidName: ({ name }: { name: string }) => `Invalid variable name: ${name}.`,
      lineBreak: ({ name }: { name: string }) => `The value of ${name} cannot contain a line break.`,
      unwritableValue: ({ name }: { name: string }) => `The value of ${name} cannot be written to .env.global.`,
      unreadable: ".env.global could not be read.",
      saveFailed: ".env.global could not be saved.",
      updatedAndRemoved: ({ name }: { name: string }) => `${name} is both set and removed.`,
    },
    editor: {
      appExists: ({ app }: { app: string }) => `The app ${app} already exists.`,
      invalidAppId: ({ app }: { app: string }) =>
        `${app} is not an app id: lowercase letters, digits, \`.\`, \`_\` and \`-\`, starting with a letter or a digit.`,
      invalidPath: ({ path }: { path: string }) => `Invalid file path: ${path}.`,
      throughFile: ({ path }: { path: string }) => `${path} goes through a file, not a folder.`,
      outsideApp: ({ app, path }: { app: string; path: string }) => `${path} leads outside the app ${app}.`,
      hiddenFile: ({ path }: { path: string }) => `${path} leads to a hidden file.`,
      brokenSymlink: ({ path }: { path: string }) => `${path} is a broken symlink.`,
      noSuchFile: ({ app, path }: { app: string; path: string }) => `The app ${app} has no file ${path}.`,
      notAFile: ({ path }: { path: string }) => `${path} is not a file.`,
      tooLarge: ({ path, size }: { path: string; size: number }) =>
        `${path} is too large to edit here: ${size} bytes, 1 MiB at most.`,
      binary: ({ path }: { path: string }) => `${path} is not a text file.`,
      notUtf8: ({ path }: { path: string }) => `${path} is not UTF-8 text: saving it from the editor would corrupt it.`,
      fileExists: ({ path }: { path: string }) => `${path} already exists.`,
      fileAppeared: ({ path }: { path: string }) =>
        `${path} appeared while it was being saved: reopen it before saving again.`,
      invalidFile: ({ path, reason }: { path: string; reason: string }) => `${path} is not valid: ${reason}`,
      // Docker's complaint keeps its lines and its own punctuation: it is shown as Docker says it.
      composeRejected: ({ path, complaint }: { path: string; complaint: string }) =>
        `Docker rejects ${path}:\n${complaint}`,
      unchecked: ({ path }: { path: string }) => `Docker could not check ${path}.`,
      filesUnreadable: ({ app }: { app: string }) => `The files of ${app} could not be listed.`,
      readFailed: ({ path }: { path: string }) => `${path} could not be read.`,
      saveFailed: ({ path }: { path: string }) => `${path} could not be saved.`,
      createFailed: ({ app }: { app: string }) => `The app ${app} could not be created.`,
    },
    docker: {
      unavailable: "The Docker daemon could not be read.",
      unknownProject: ({ project }: { project: string }) => `No app ${project} is installed.`,
      invalidProject: ({ project }: { project: string }) =>
        `${project} is not a compose project name: lowercase letters, digits, \`_\` and \`-\`, starting with a letter or a digit.`,
      unknownContainer: ({ project, container }: { project: string; container: string }) =>
        `The app ${project} has no container ${container}.`,
    },
    compose: {
      noApps: "A compose command needs at least one app.",
      appBusy: ({ app }: { app: string }) => `Another command runs on ${app}: try again once it has ended.`,
      unchecked: ({ command }: { command: string }) => `The batch of ${command} could not be checked.`,
      failed: ({ app, command }: { app: string; command: string }) => `${command} failed on ${app}.`,
      unknownBatch: "This compose command ended too long ago: its output is no longer kept.",
    },
    jobs: {
      unknownRun: "This run of a job is no longer kept: read the jobs again.",
      ended: "This run of a job has ended already.",
      crashed: "The job stopped short.",
    },
    widgets: {
      unknownPlacement: "This widget is no longer on the dashboard: reload the page.",
      unavailable: "Its service did not answer.",
      unknownImage: "The widget has no such image.",
    },
    auth: {
      invalidCredentials: "Invalid email or password.",
      tooManySignIns: "Too many failed sign-ins for this email: try again later.",
      tooManySignInsFor: ({ wait }: { wait: string }) =>
        `Too many failed sign-ins for this email: try again in ${wait}.`,
      sessionExpired: "Your session is no longer valid, or has expired: sign in again.",
      userRemoved: "Your user is no longer in hangar.yml.",
      credentialsChanged: "Your credentials have changed: sign in again.",
      unreadableCookie: "The browser sent a cookie that is not text: sign in again.",
      noOidcProvider: "No OpenID Connect provider is configured.",
      crossOrigin: ({ origin }: { origin: string }) => `The request comes from another origin than ${origin}.`,
    },
  },
} as const;
