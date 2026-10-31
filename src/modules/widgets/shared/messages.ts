/** The words every widget card shares: its loading and error states, and a container host's counts. */
export class WidgetsMessages {
  static readonly en = {
    loading: ({ title }: { title: string }) => `Loading ${title}`,
    unavailable: ({ title }: { title: string }) => `${title} is unavailable`,
    host: {
      containers: ({ count }: { count: string }) => `${count} containers`,
      running: "Running",
      stopped: "Stopped",
      images: "Images",
      volumes: "Volumes",
      imagesDetail: ({ unused, size }: { unused: string; size: string }) => `${unused} unused · ${size}`,
      volumesDetail: ({ inUse, unused }: { inUse: string; unused: string }) => `${inUse} in use · ${unused} unused`,
    },
  };

  static readonly fr: typeof WidgetsMessages.en = {
    loading: ({ title }) => `Chargement de ${title}`,
    unavailable: ({ title }) => `${title} indisponible`,
    host: {
      containers: ({ count }) => `${count} conteneurs`,
      running: "Actifs",
      stopped: "Arrêtés",
      images: "Images",
      volumes: "Volumes",
      imagesDetail: ({ unused, size }) => `${unused} inutilisées · ${size}`,
      volumesDetail: ({ inUse, unused }) => `${inUse} utilisés · ${unused} inutilisés`,
    },
  };
}
