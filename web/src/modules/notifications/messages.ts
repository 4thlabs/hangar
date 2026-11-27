import { commonMessages } from "#modules/common/messages.ts";

const { logHint } = commonMessages.errors;

/** What `notifications` says: the bell, and the words of each notification the server files. */
export const notificationsMessages = {
  menu: {
    title: "Notifications",
    unreadLabel: ({ count }: { count: number }) => `Notifications, ${count} unread`,
    unreadMark: "Unread",
    unread: ({ count }: { count: number }) => `${count} unread`,
    empty: "No notifications",
    emptyDescription: "Commands run in the background will land here.",
  },
  /** What a notification of a key this page does not know says. */
  unknown: "Notification",
  storeInstalled: { title: "Store: installation finished", description: "The store was installed." },
  storeUpdated: { title: "Store: update finished", description: "The store was updated." },
  storeInstallFailed: {
    title: "Store: installation failed",
    description: `The installation of the store failed. ${logHint}`,
  },
  storeUpdateFailed: {
    title: "Store: update failed",
    description: `The update of the store failed. ${logHint}`,
  },
  composeSucceeded: {
    title: ({ label }: { label: string }) => `${label} finished`,
    plainTitle: "Docker Compose finished",
    plainDescription: ({ project }: { project: string }) => `The command succeeded for ${project}.`,
  },
  composeFailed: {
    title: ({ label }: { label: string }) => `${label} failed`,
    plainLabel: "Docker Compose",
    description: ({ project }: { project: string }) => `The Docker Compose command failed for ${project}. ${logHint}`,
  },
  updatesAvailable: {
    title: "Updates available",
    description: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "app has" : "apps have"} a newer image in the registry.`,
  },
  autoUpdate: {
    title: "Automatic update",
    description: ({ updated, failed }: { updated: number; failed: string }) =>
      `${updated} ${updated === 1 ? "app was" : "apps were"} updated.${failed ? ` Failed for: ${failed}.` : ""}`,
  },
} as const;
