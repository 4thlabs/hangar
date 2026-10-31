import { Plural } from "#libs/i18n";

/** The Beszel card's words. */
export class BeszelMessages {
  static readonly en = {
    title: "Beszel",
    errorDescription: "The server stats could not be loaded.",
    servers: ({ count }: { count: number }) =>
      `${count} ${Plural.select("en", count, { one: "server", other: "servers" })}`,
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
    servers: ({ count }) => `${count} ${Plural.select("fr", count, { one: "serveur", other: "serveurs" })}`,
    down: ({ count }) => `${count} hors ligne`,
    uptime: ({ span }) => `en ligne depuis ${span}`,
    empty: "Aucun serveur surveillé.",
    cpu: "CPU",
    memory: "RAM",
    disk: "Disque",
  };
}
