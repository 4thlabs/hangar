/** The host terminal's words: its dialog, its setup and the SSH key it signs in with. */
export class TerminalMessages {
  static readonly en = {
    title: "Terminal",
    shortcut: ({ shortcut }: { shortcut: string }) => `Terminal (${shortcut})`,
    panelLabel: "The server's terminal",
    description: ({ host, username }: { host: string; username: string }) =>
      `A shell on ${host}, as ${username}, over SSH. It stays open when you close the window or reload the page, until an hour of inactivity.`,
    notConfigured: "No server is configured.",
    /** Shown in a terminal another tab took over. */
    takenOver: "Session taken over in another tab.",
    /** What Hangar says in the terminal while it signs in; the shell's own output is the host's. */
    shell: {
      connecting: ({ account }: { account: string }) => `Connecting to ${account}…`,
      keyUnreadable: ({ file }: { file: string }) =>
        `Could not read the imported key (${file}): check its permissions.`,
      shellRefused: ({ reason }: { reason: string }) => `The server refused to open a shell: ${reason}`,
      closed: "Connection closed.",
      knownHostsUnreadable: ({ file }: { file: string }) =>
        `Could not read ${file}, where Hangar keeps the server's key: check its permissions.`,
      hostKeyChanged: ({ address, file }: { address: string; file: string }) =>
        `The key of ${address} changed since the first connection: connection refused. If it was reinstalled, remove its line from ${file}, then connect again.`,
      cancelled: "Connection cancelled.",
      accessDenied: ({ username }: { username: string }) =>
        `Access denied for ${username}: check the password, or import a key its ~/.ssh/authorized_keys allows.`,
      unreachable: ({ address, reason }: { address: string; reason: string }) =>
        `Could not reach ${address}: ${reason}`,
      retry: "Access denied, try again.",
      password: ({ account }: { account: string }) => `Password for ${account}: `,
      importedKeyIgnored: "The imported key is unreadable: it is ignored.",
      passphrase: "Key passphrase: ",
      wrongPassphrase: "Wrong passphrase.",
    },
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
    takenOver: "Session reprise dans un autre onglet.",
    shell: {
      connecting: ({ account }) => `Connexion à ${account}…`,
      keyUnreadable: ({ file }) => `Impossible de lire la clé importée (${file}) : vérifiez ses droits.`,
      shellRefused: ({ reason }) => `Le serveur a refusé d’ouvrir un shell : ${reason}`,
      closed: "Connexion fermée.",
      knownHostsUnreadable: ({ file }) =>
        `Impossible de lire ${file}, où Hangar garde la clé du serveur : vérifiez ses droits.`,
      hostKeyChanged: ({ address, file }) =>
        `La clé de ${address} a changé depuis la première connexion : connexion refusée. S’il a été réinstallé, retirez sa ligne de ${file}, puis reconnectez-vous.`,
      cancelled: "Connexion annulée.",
      accessDenied: ({ username }) =>
        `Accès refusé pour ${username} : vérifiez le mot de passe, ou importez une clé que son ~/.ssh/authorized_keys autorise.`,
      unreachable: ({ address, reason }) => `Impossible de joindre ${address} : ${reason}`,
      retry: "Accès refusé, réessayez.",
      password: ({ account }) => `Mot de passe de ${account} : `,
      importedKeyIgnored: "La clé importée est illisible : elle est ignorée.",
      passphrase: "Phrase de passe de la clé : ",
      wrongPassphrase: "Phrase de passe incorrecte.",
    },
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
