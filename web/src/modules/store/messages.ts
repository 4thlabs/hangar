import type { AppFilter } from "#libs/api";

/** What `store` says: the store's page, its apps' cards, and the editor of an app's files. */
export const storeMessages = {
  /** What each filter is called in the menu. */
  filter: {
    installed: "Installed",
    available: "Not installed",
  } satisfies Record<AppFilter, string>,
  filterMenu: "Installation",
  list: {
    documentTitle: "Store | Hangar",
    title: "Store",
    newApp: "New app",
    empty: "No apps available in the store.",
    noResults: "No app matches this search.",
    loading: "Loading the store…",
  },
  card: {
    edit: ({ name }: { name: string }) => `Edit ${name}`,
    swarm: "Swarm",
    swarmHint: "Has a compose.swarm.yml: once installed, it deploys from the Cluster page",
  },
  install: {
    install: "Install",
    installApp: ({ name }: { name: string }) => `Install ${name}`,
    installing: "Installing…",
    installingApp: ({ name }: { name: string }) => `Installing ${name}`,
    installed: "App installed",
    installedDescription: ({ name }: { name: string }) => `${name} was installed.`,
    installFailed: "Installation failed",
    uninstall: "Uninstall",
    uninstallApp: ({ name }: { name: string }) => `Uninstall ${name}`,
    uninstalled: "App uninstalled",
    uninstalledDescription: ({ name }: { name: string }) => `${name} was uninstalled.`,
    uninstallFailed: "Uninstallation failed",
    confirmTitle: ({ name }: { name: string }) => `Uninstall ${name}?`,
    confirmDescription:
      "The app's containers are stopped and removed, then the app is taken off the installed apps. The volumes are kept.",
  },
  newApp: {
    documentTitle: "New app | Hangar",
    title: "New app",
    identifier: "Identifier",
    identifierPlaceholder: "my-app",
    identifierDescription: "The app's folder in the store, and the name of its compose project.",
    saved: "App saved",
    savedDescription: ({ id }: { id: string }) => `${id} was added to the store.`,
    rejected: "App rejected",
  },
  editor: {
    documentTitle: ({ name }: { name: string }) => `${name} | Hangar`,
    cannotEdit: "This app cannot be edited here",
    save: "Save",
    validating: "Validating…",
    files: "The app's files",
    filesTitle: "Files",
    unsaved: "unsaved changes",
    newFile: "New file",
    newFilePath: "Path of the new file",
    newFilePlaceholder: "config/settings.yml",
    fileSaved: "File saved",
    fileSavedDescription: ({ path }: { path: string }) => `${path} was saved.`,
    fileCreated: "File created",
    fileCreatedDescription: ({ path }: { path: string }) => `${path} was created.`,
    fileRejected: "File rejected",
  },
} as const;
