/** The bell's own words; what each notification says is in `NotificationMessages`. */
export class NotificationsMenuMessages {
  static readonly en = {
    title: "Notifications",
    unreadLabel: ({ count }: { count: number }) => `Notifications, ${count} unread`,
    unread: ({ count }: { count: number }) => `${count} unread`,
    unreadMark: "Unread",
    emptyTitle: "No notifications",
    emptyDescription: "Commands run in the background will land here.",
    /** A notification whose words this version no longer has. */
    unknown: "Notification",
  };

  static readonly fr: typeof NotificationsMenuMessages.en = {
    title: "Notifications",
    unreadLabel: ({ count }) => `Notifications, ${count} non lues`,
    unread: ({ count }) => `${count} non lues`,
    unreadMark: "Non lue",
    emptyTitle: "Aucune notification",
    emptyDescription: "Les commandes lancées en arrière-plan viendront se ranger ici.",
    unknown: "Notification",
  };
}
