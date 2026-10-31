/** What the API routes answer when they fail, for the client to show as is. */
export class ApiMessages {
  static readonly en = {
    authRequired: "Authentication required.",
    unavailable: {
      backups: "Backups are unavailable.",
      daemon: "The Docker daemon is unavailable.",
      dockerLogs: "Docker logs are unavailable.",
      dockerStats: "Docker statistics are unavailable.",
      notifications: "Notifications are unavailable.",
      serviceLogs: "The service's logs are unavailable.",
      terminal: "The terminal is unavailable.",
      widgetImages: "Widget images are unavailable.",
    },
    notFound: {
      archive: "This archive does not exist.",
      container: "This container no longer exists.",
      service: "This service no longer exists.",
      terminal: "This terminal is closed.",
    },
    invalidCompose: "The Docker Compose command is invalid.",
    invalidTerminalMessage: "The terminal message is invalid.",
    invalidTerminalSize: "The terminal size is invalid.",
    noHost: "No server is configured: set HANGAR_SSH_HOST and HANGAR_SSH_USER.",
    notSwarmReady: ({ stack }: { stack: string }) => `${stack} is not an installed app ready for the swarm.`,
    noWidgetImage: "No image to relay for this widget.",
  };

  static readonly fr: typeof ApiMessages.en = {
    authRequired: "Authentification requise.",
    unavailable: {
      backups: "Les sauvegardes sont indisponibles.",
      daemon: "Le daemon Docker est indisponible.",
      dockerLogs: "Les logs Docker sont indisponibles.",
      dockerStats: "Les statistiques Docker sont indisponibles.",
      notifications: "Les notifications sont indisponibles.",
      serviceLogs: "Les logs du service sont indisponibles.",
      terminal: "Le terminal est indisponible.",
      widgetImages: "Les images des widgets sont indisponibles.",
    },
    notFound: {
      archive: "Cette archive n’existe pas.",
      container: "Ce conteneur n’existe plus.",
      service: "Ce service n’existe plus.",
      terminal: "Ce terminal est fermé.",
    },
    invalidCompose: "La commande Docker Compose est invalide.",
    invalidTerminalMessage: "Le message du terminal est invalide.",
    invalidTerminalSize: "La taille du terminal est invalide.",
    noHost: "Aucun serveur n’est configuré : renseignez HANGAR_SSH_HOST et HANGAR_SSH_USER.",
    notSwarmReady: ({ stack }) => `${stack} n’est pas une app installée prête pour le swarm.`,
    noWidgetImage: "Aucune image à relayer pour ce widget.",
  };
}
