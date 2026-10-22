# Spec: Host terminal

- **Status:** Implemented
- **Date:** 2026-10-22
- **Owner:** Thomas

## Goal

A **Terminal** page with a shell on the server Hangar runs on, without leaving Hangar for an SSH client.
It builds on [the container terminal](container-terminal.md): same transport, same sessions, same panel.

Out of scope: the other nodes of a swarm, choosing the host or the account from the page, an SSH agent,
and keeping a session alive across a page reload.

## Reaching the host

Hangar runs in a container: a shell it spawns itself would be the container's. It signs in to the host
over SSH instead, with `ssh2` (already in the tree through `dockerode`).

A privileged helper container entering the host's namespaces (`nsenter -t 1`) was the alternative: no
setup, but a root shell for every signed-in user. SSH lands in an account the operator picks, with the
rights they chose to share, and, without an imported key, only for whoever knows its password.

## Configuration

| Variable          | Default | Meaning                    |
| ----------------- | ------- | -------------------------- |
| `HANGAR_SSH_HOST` | —       | The host to sign in to     |
| `HANGAR_SSH_USER` | —       | The account to sign in as  |
| `HANGAR_SSH_PORT` | `22`    | The port `sshd` listens on |

Until both the host and the account are set, `hostShells` is `null`: the page explains the setup, and
the route answers 404. The port is checked at startup, 1 to 65535.

## Signing in, from the terminal

The terminal opens at once, and Hangar signs in from it the way `ssh` does: no form, and no secret in the
request that opens the session. The password and the passphrase reach the session as keystrokes, through
`/api/terminals/[terminal]`, and are neither stored nor logged.

- `SshTerminal` is the session's stream until the shell opens: it prints Hangar's lines and questions,
  and reads the answers with a small line editor (hidden unless the host asks for echo; Backspace,
  Ctrl+U; Ctrl+C or Ctrl+D on an empty line gives up; arrows are ignored). Once signed in, it hands the
  keys and the output over to the shell's channel, bytes as they are, and resizes it to the client's
  latest size.
- `SshSignIn` is ssh2's `authHandler`, asked for the next method after each refusal:
  1. The imported key, when there is one. An encrypted key asks for its passphrase: three tries, an empty
     one skips the key.
  2. `none`, to learn which methods the host takes, before asking anything.
  3. `keyboard-interactive` when offered, as `ssh` prefers it: the host's own questions are shown, a
     one-time code included. A round that fails without asking anything (a host without PAM offers the
     method and refuses it at once) drops it for the password.
  4. `password`, asked as `Mot de passe de user@host :`.

  At most three rounds that asked something, as `ssh`'s `NumberOfPasswordPrompts`; the terminal says
  `Accès refusé, réessayez.` between them.

- A failure is said in red in the terminal, which then ends: refused, cancelled, host key changed (the
  `known_hosts` line to remove), `known_hosts` unreadable, host out of reach (with ssh2's reason), shell
  refused. **Reconnecter** starts over.
- ssh2's ready timeout is 3 minutes: its countdown runs while the questions wait.

## Keys

- **Imported key.** `SshKeyStore` keeps the private key the operator imports from **Clé SSH**, in
  `app-data/hangar/ssh/id_key` (`0600`, written to a `.partial` file then renamed). It is checked before it
  replaces anything: a public key, a file holding no key, or one over 16 KiB is refused. An encrypted key
  is accepted, its passphrase asked at each connection. It is read at each connection, so replacing or
  removing it takes effect at once. The dialog shows its type and fingerprint, never the key.
- **Host key.** `SshKnownHosts` trusts the first key a `host:port` presents and records its fingerprint
  (`SHA256:…`, as `ssh-keygen -l` prints it) in `app-data/hangar/ssh/known_hosts`; a different key
  afterwards is refused. Checks are chained, so two first connections cannot both record one. Deleting the
  line trusts the next key.

## Server

- `HostShells` (`#libs/ssh`, bound in `#libs/ssh/server`) opens one SSH connection per shell, with a 30 s
  keepalive, then the account's login shell with a TTY sized to the terminal and `TERM=xterm-256color`.
  It hands `TerminalSessions` the `SshTerminal` stream at once, and closing the connection ends the shell.
  Unlike `docker exec`, that hangs up the shell and its jobs — verified against OpenSSH: a `sleep` started
  in the background is gone.
- Its `error` listener is attached before connecting and stays: ssh2 can emit a second `error` for one
  failed connection, which with no listener would bring the server down.
- `POST /api/host/terminal` goes through `terminalStream`, like the container's route.

## UI

- `/terminal`, in the main navigation: the host and account, a **Clé SSH** dialog (import, replace or
  remove the key; the host key's fingerprint once recorded), and the terminal filling the rest of the
  page. The shell opens on arrival and closes on leaving.
- Not configured, a card gives the `compose.yml` lines naming the host (`host.docker.internal` through
  `extra_hosts: host-gateway`).
- `TerminalPanel` stays a lazy chunk, rendered only once in the browser (`useInBrowser`): xterm touches
  `window` on load, and the page, unlike the sheet, renders on the server. Its terminal element is
  absolute in its frame, so the rows drawn never stretch the frame they are fitted to.

## Security

The page is open to any signed-in user, like the container terminals and the compose operations: Hangar
has no roles, and registration is open. Without an imported key, the account's password is the barrier;
with one, anyone signed in to Hangar gets the account's shell. No command is logged, only the opening and
closing of a session, with the user, host and account.

## Tests

- `SshTerminal`: hidden and echoed answers, Backspace and Ctrl+U, arrows ignored, Ctrl+C and Ctrl+D, the
  client leaving mid-question, keys typed early dropped; once attached, keys and bytes passed through, the
  latest size applied, the stream closed when the shell exits, a shell opened too late closed.
- `HostShells`, against a fake ssh2 client playing the host's side of the sign-in: the password asked and
  hidden, three tries, keyboard-interactive preferred, one that asks nothing dropped for the password,
  Ctrl+C, the key tried first and alone when taken, an encrypted key's passphrase, the password after a
  refused key, a changed host key, a host out of reach with ssh2's second error, resize and end.
- `SshKeyStore`: a key kept `0600` and described, an encrypted one accepted, a public key, garbage or an
  oversized file refused without touching the key in place, removal.
- `SshKnownHosts`: the first key trusted and recorded, the same one trusted again, another refused, one
  key per address, the fingerprint format.
- The route: 401, the stream with its id, 404 while unconfigured.
- Against a real OpenSSH (Alpine, no PAM): a wrong password then the right one, Ctrl+C, an encrypted key
  with its passphrase, and no process left once the session closes.
