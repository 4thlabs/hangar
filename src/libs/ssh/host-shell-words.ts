/**
 * What Hangar itself says in the host terminal, in the reader's language: the shell's own output is the host's. The
 * caller hands them in when it opens the terminal, from the UI's catalog.
 */
export type HostShellWords = {
  connecting: (params: { account: string }) => string;
  keyUnreadable: (params: { file: string }) => string;
  shellRefused: (params: { reason: string }) => string;
  closed: string;
  knownHostsUnreadable: (params: { file: string }) => string;
  hostKeyChanged: (params: { address: string; file: string }) => string;
  cancelled: string;
  accessDenied: (params: { username: string }) => string;
  unreachable: (params: { address: string; reason: string }) => string;
  retry: string;
  password: (params: { account: string }) => string;
  importedKeyIgnored: string;
  passphrase: string;
  wrongPassphrase: string;
};
