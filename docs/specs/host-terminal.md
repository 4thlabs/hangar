# Spec: Host terminal

- **Status:** Implemented
- **Date:** 2026-10-22
- **Owner:** Thomas

## Goal

A terminal in the navbar with a shell on the server Hangar runs on, without leaving Hangar for an SSH
client. It builds on [the container terminal](container-terminal.md): same transport, same sessions, same
panel.

Unlike a container's shell, the host's outlives its window and the page: it is used as an SSH session is,
a command left running while one looks at the apps, and found again on return.

Out of scope: the other nodes of a swarm, choosing the host or the account from Hangar, an SSH agent,
and a session surviving Hangar's restart.

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

Until both the host and the account are set, `hostShells` is `null`: the dialog explains the setup, and
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

## Session

Each Hangar user has one session on the host, kept by `TerminalSessions.attach` under the host's
`host:port`, the way `tmux` keeps one:

- **Found again.** Opening the terminal attaches to the user's session when there is one, and starts it
  otherwise. Nothing is stored in the browser: the server knows whose session it is, so navigating away
  and back, reloading, or coming from another tab or machine all find it.
- **Replayed.** The session keeps its latest 256 KiB of output, the heartbeat left out, and sends them to
  the client that attaches before the live output; the shell is then resized to that client. A
  full-screen program whose size did not change is not told to redraw: Ctrl+L does it. The
  `X-Terminal-Replay` header gives the replay's length, and the terminal takes it with its input off
  (`disableStdin`): the queries it holds (vim's `ESC [ > c`, a cursor position) were answered once, and an
  answer now would reach the shell as keystrokes. The replay is cut at a chunk boundary when it can,
  at a byte otherwise, and modes set before it are lost.
- **One client at a time.** A client attaching while another reads takes the session over: the first
  one's terminal shows `Session reprise dans un autre onglet.` and its stream ends. Its **Reconnecter**
  takes the session back. Two clients arriving before the shell started share the one shell.
- **Ended** when the shell exits (`exit`, the connection dropped, a failed sign-in), or after an hour
  without a keystroke, a resize or output, whether a client reads it or not, so a forgotten shell does
  not linger (`TerminalSessions.KeptIdleMs`). A client attaching counts too, as it resizes the shell. The
  next opening then starts a new one. A program that keeps printing, such as `top`, keeps its session.
- **Ended at sign-out** too, with every other terminal of the user: a session deleted by Better Auth
  (`databaseHooks.session.delete`) calls `TerminalSessions.closeAll`. Signing out of one browser ends the
  terminals of the others.
- While no client reads it, the shell's output keeps flowing into the replayed output, so a command
  writing a lot is never held back. While one reads, a slow client holds the shell back, as `pipe` did;
  the client taking over from it lets the shell write again.
- In memory only: a restart of Hangar ends every session.

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
  A sign-in under way waits in a kept session like the shell does: the replay shows its question again.
  Unlike `docker exec`, that hangs up the shell and its jobs — verified against OpenSSH: a `sleep` started
  in the background is gone.
- Its `error` listener is attached before connecting and stays: ssh2 can emit a second `error` for one
  failed connection, which with no listener would bring the server down.
- `POST /api/host/terminal` goes through `terminalStream`, like the container's route, with
  `terminals.attach` where the container's has `terminals.open`.

## UI

- A terminal button in the navbar, beside the notifications, opens a dialog in the middle of the page:
  the host and account, a **Clé SSH** dialog (import, replace or remove the key; the host key's
  fingerprint once recorded), and the terminal; the description says it stays open. The session opens at
  the first opening. Closing the dialog keeps the terminal mounted (`keepMounted`), stream included, and
  the navbar outlives navigation: reopening finds it as it was, without a replay. After a reload, the
  dialog attaches again (see § Session).
- Unlike a container's, the panel has no **Fermer la session** button: the session ends with `exit`, idle,
  or at sign-out.
- The **Clé SSH** dialog's reads (the imported key, the host key) sit behind a `Suspense` boundary: the
  layout renders the terminal on every page, which must not wait for them.
- Not configured, a card gives the `compose.yml` lines naming the host (`host.docker.internal` through
  `extra_hosts: host-gateway`).
- `TerminalPanel` stays a lazy chunk, rendered only once in the browser (`useInBrowser`): xterm touches
  `window` on load, and the navbar, unlike the sheet, renders on the server. Its terminal element is
  absolute in its frame, so the rows drawn never stretch the frame they are fitted to.

## Security

The terminal is open to any signed-in user, like the container terminals and the compose operations:
Hangar has no roles, and registration is open. Without an imported key, the account's password is the
barrier; with one, anyone signed in to Hangar gets the account's shell. No command is logged, only the
opening and closing of a session, with the user, host and account, and each client attaching and leaving.

A kept session is a signed-in shell waiting for its owner, up to an hour once idle, and never past their
sign-out. Only that Hangar user reaches it: the session is found by their id, and an id from someone
else's reads as missing.

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
- `TerminalSessions.attach`: the shell started once and sized to the client, kept when the client leaves,
  its output replayed and the shell resized to the next one, a second client taking over (the first told,
  and its late abort ignored), two clients at once sharing one shell, one session per user, the end after
  an hour without activity with a client or without, keystrokes, resizes, output and a client coming back
  counting as activity, the timer stopped with the session, none for a container's, a new shell once the
  previous exited or was closed, the replay's length, the shell let go of by a client taking over from one
  that held it back. `closeAll`: the user's sessions ended, kept or not, no one else's. `TerminalScrollback`:
  the latest bytes kept, a chunk over the capacity cut.
- `TerminalView.follow`, in happy-dom: the replay written with the input off, up to its last byte within a
  chunk, the live output with it on.
- Better Auth: signing out reports the user, whose terminals then end.
- The route: 401, the user's session attached under the host's address and its shell started at the size
  given, 404 while unconfigured. `DELETE` on a session: 401, closed as its owner, 404 once gone.
- `HostTerminalDialog`, rendered in happy-dom: no terminal before the first opening, mounted then, and
  kept mounted, the same instance, once the dialog is closed and reopened.
- Against a real OpenSSH (Alpine, no PAM): a wrong password then the right one, Ctrl+C, an encrypted key
  with its passphrase, and no process left once the session closes.
