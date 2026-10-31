/** The host terminal's words: its dialog, its setup and the SSH key it signs in with. */
export class TerminalMessages {
  static readonly en = {
    title: "Terminal",
    shortcut: ({ shortcut }: { shortcut: string }) => `Terminal (${shortcut})`,
    panelLabel: "The server's terminal",
    description: ({ host, username }: { host: string; username: string }) =>
      `A shell on ${host}, as ${username}, over SSH. It stays open when you close the window or reload the page, until an hour of inactivity.`,
    notConfigured: "No server is configured.",
    setup: {
      title: "Set up access to the server",
      description:
        "Hangar opens the terminal over SSH on the account of your choice, and asks for its password in the terminal. An imported key (SSH key button) saves typing it.",
      /** Around the file name and the host name, set in code. */
      instructions: {
        before: "Name the server in Hangar's ",
        middle: ", then recreate its container. ",
        after: " stands for the machine that hosts it; another address works too.",
      },
      /** The account placeholder in the compose snippet. */
      user: "your-user",
    },
    key: {
      trigger: "SSH key",
      title: "SSH connection",
      description:
        "Without a key, the terminal asks for the account's password on each connection. With a key its ~/.ssh/authorized_keys allows, it tries that first.",
      privateKey: "Private key",
      file: "Private key file",
      importing: "Importing…",
      import: "Import a key",
      replace: "Replace the key",
      delete: "Delete",
      imported: "Key imported",
      importFailed: "Import: failed",
      deleted: "Key deleted",
      deleteFailed: "Deletion: failed",
      fingerprint: "Server fingerprint",
      /** Around the command, set in code. */
      fingerprintHint: {
        before: "Recorded at the first connection; another key will be refused. Compare it with ",
        after: " on the server.",
      },
      noFingerprint: "None yet: Hangar will record the key the server presents at the first connection.",
      none: "No key imported.",
      unreadable: "The imported key is unreadable: replace it, or delete it. The details are in the server logs.",
      encrypted: "A key protected by a passphrase, asked for on each connection.",
      /** Around the fingerprint, set in code. */
      summary: ({ type }: { type: string }) => ({ before: `${type} key, `, after: "." }),
      importedMessage: ({ type }: { type: string }) => `${type} key imported.`,
      importedEncrypted: "Key imported: its passphrase will be asked for on each connection.",
      notAKey: "This file holds no readable SSH private key.",
      importError: "Importing the key failed.",
      deleteError: "Deleting the key failed.",
      deletedMessage: "Key deleted: the terminal will ask for the password.",
    },
  };

  static readonly fr: typeof TerminalMessages.en = {
    title: "Terminal",
    shortcut: ({ shortcut }) => `Terminal (${shortcut})`,
    panelLabel: "Terminal du serveur",
    description: ({ host, username }) =>
      `Un shell sur ${host}, en tant que ${username}, par SSH. Il reste ouvert quand vous fermez la fenêtre ou rechargez la page, jusqu’à une heure d’inactivité.`,
    notConfigured: "Aucun serveur n’est configuré.",
    setup: {
      title: "Configurer l’accès au serveur",
      description:
        "Hangar ouvre le terminal en SSH sur le compte de votre choix, et demande son mot de passe dans le terminal. Une clé importée (bouton Clé SSH) évite de le taper.",
      instructions: {
        before: "Indiquez le serveur dans le ",
        middle: " de Hangar, puis recréez son conteneur. ",
        after: " désigne la machine qui l’héberge ; une autre adresse convient aussi.",
      },
      user: "votre-utilisateur",
    },
    key: {
      trigger: "Clé SSH",
      title: "Connexion SSH",
      description:
        "Sans clé, le terminal demande le mot de passe du compte à chaque connexion. Avec une clé que son ~/.ssh/authorized_keys autorise, il l’essaie d’abord.",
      privateKey: "Clé privée",
      file: "Fichier de la clé privée",
      importing: "Import…",
      import: "Importer une clé",
      replace: "Remplacer la clé",
      delete: "Supprimer",
      imported: "Clé importée",
      importFailed: "Import : échec",
      deleted: "Clé supprimée",
      deleteFailed: "Suppression : échec",
      fingerprint: "Empreinte du serveur",
      fingerprintHint: {
        before: "Enregistrée à la première connexion ; une autre clé sera refusée. Comparez-la à ",
        after: " sur le serveur.",
      },
      noFingerprint: "Aucune encore : Hangar enregistrera la clé que le serveur présentera à la première connexion.",
      none: "Aucune clé importée.",
      unreadable:
        "La clé importée est illisible : remplacez-la, ou supprimez-la. Le détail est dans les logs du serveur.",
      encrypted: "Une clé protégée par une phrase de passe, demandée à chaque connexion.",
      summary: ({ type }) => ({ before: `Clé ${type}, `, after: "." }),
      importedMessage: ({ type }) => `Clé ${type} importée.`,
      importedEncrypted: "Clé importée : sa phrase de passe sera demandée à chaque connexion.",
      notAKey: "Ce fichier ne contient pas de clé privée SSH lisible.",
      importError: "L’import de la clé a échoué.",
      deleteError: "La suppression de la clé a échoué.",
      deletedMessage: "Clé supprimée : le terminal demandera le mot de passe.",
    },
  };
}
