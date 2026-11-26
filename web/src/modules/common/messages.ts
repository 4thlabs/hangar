/** The app shell's words: navigation, navbar, and the pages the shell answers itself. */
export class CommonMessages {
  static readonly en = {
    /** The page description search engines and link previews show. */
    metaDescription: "Hangar — your self-hosted apps.",
    navigation: {
      label: "Main navigation",
      general: "General",
      administration: "Administration",
      dashboard: "Dashboard",
      apps: "Apps",
      cluster: "Cluster",
      store: "Store",
      settings: "Settings",
    },
    navbar: {
      home: "Hangar — Dashboard",
      settings: "Settings",
    },
    /** A page of the navigation the new server does not serve yet: each comes with the issue of its area. */
    pending: {
      title: "Not here yet",
      description: "This page is still served by the current version of Hangar.",
    },
    notFound: {
      title: "Page not found",
      description: "Nothing lives at this address.",
      home: "Back to the dashboard",
    },
  };

  static readonly fr: typeof CommonMessages.en = {
    metaDescription: "Hangar — vos applications auto-hébergées.",
    navigation: {
      label: "Navigation principale",
      general: "Général",
      administration: "Administration",
      dashboard: "Dashboard",
      apps: "Apps",
      cluster: "Cluster",
      store: "Store",
      settings: "Paramètres",
    },
    navbar: {
      home: "Hangar — Dashboard",
      settings: "Paramètres",
    },
    pending: {
      title: "Pas encore ici",
      description: "Cette page est encore servie par la version actuelle de Hangar.",
    },
    notFound: {
      title: "Page introuvable",
      description: "Rien ne se trouve à cette adresse.",
      home: "Retour au dashboard",
    },
  };
}
