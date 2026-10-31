/** The local Docker card's words; the host counts are in `WidgetsMessages`. */
export class DockerWidgetMessages {
  static readonly en = {
    title: "Local",
    errorDescription: "The local Docker statistics could not be loaded.",
    updates: "Updates available",
  };

  static readonly fr: typeof DockerWidgetMessages.en = {
    title: "Local",
    errorDescription: "Les statistiques Docker locales n’ont pas pu être chargées.",
    updates: "Mises à jour disponibles",
  };
}
