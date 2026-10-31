/** The Beszel card's words. */
export class BeszelMessages {
  static readonly en = {
    title: "Beszel",
    errorDescription: "The server stats could not be loaded.",
    servers: ({ count }: { count: number }) => (count === 1 ? "1 server" : `${count} servers`),
    down: ({ count }: { count: number }) => `${count} down`,
    uptime: ({ span }: { span: string }) => `${span} up`,
    empty: "No servers monitored.",
    cpu: "CPU",
    memory: "RAM",
    disk: "Disk",
  };

  static readonly fr: typeof BeszelMessages.en = {
    title: "Beszel",
    errorDescription: "Les statistiques des serveurs n’ont pas pu être chargées.",
    servers: ({ count }) => (count > 1 ? `${count} serveurs` : `${count} serveur`),
    down: ({ count }) => `${count} hors ligne`,
    uptime: ({ span }) => `en ligne depuis ${span}`,
    empty: "Aucun serveur surveillé.",
    cpu: "CPU",
    memory: "RAM",
    disk: "Disque",
  };
}
