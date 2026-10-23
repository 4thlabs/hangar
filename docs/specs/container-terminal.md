# Spec: Container terminal

- **Status:** Implemented
- **Date:** 2026-10-22
- **Owner:** Thomas

## Goal

Open a shell in a running container of an app, from its page, without leaving Hangar for an SSH session
and a `docker exec -it`. It sits as a **Terminal** tab beside the logs, in the sheet each container row
already opens.

Out of scope: Swarm tasks (they run on other nodes, whose daemon Hangar does not reach), choosing the
user or the command, keeping a session alive across a page reload, and recording sessions.

## Libraries

| Need                       | Library                                  | Why this one                                                         |
| -------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| Terminal emulator          | `@xterm/xterm` 6                         | What VS Code and Portainer ship: VT parsing, selection, copy, colors |
| Fit to the panel           | `@xterm/addon-fit`                       | Computes `cols × rows` from the element's size                       |
| Shell in the container     | `dockerode` (already there)              | `exec` with `Tty` and a hijacked stream, plus `exec.resize`          |
| Transport, auth, streaming | `apiRoute` / `apiStream` (already there) | Same path as the logs: session check, 401/404/503, unbuffered stream |

No WebSocket. Waku exposes no upgrade hook: it would take a custom `waku.server.ts` wrapping the
`unstable_` adapter for production, and a separate Vite plugin for `waku dev`, whose server runs the
routes in another module graph. Two code paths on unstable APIs, for a keystroke latency a homelab
cannot tell apart from one HTTP round trip.

## Transport

Two routes, both behind `apiRoute` (a session is required):

| Route                                                             | Body                            | Answers                                                         |
| ----------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------- |
| `POST /api/docker/apps/[project]/containers/[container]/terminal` | `{ cols, rows }`                | The raw TTY output, streamed; the session id in `X-Terminal-Id` |
| `POST /api/terminals/[terminal]`                                  | `{ input }` or `{ cols, rows }` | `204`; `404` once the session is gone                           |
| `DELETE /api/terminals/[terminal]`                                | —                               | `204`, the shell ended; `404` once the session is gone          |

- The output is `application/octet-stream`: bytes go straight into `Terminal.write`, which decodes
  UTF-8 across chunk boundaries itself. It is not compressed (not a compressible type), and
  `X-Accel-Buffering: no` keeps a proxy from holding it.
- **Message order.** Two POSTs in flight can land in either order. The client (`TerminalOutbox`) sends
  one at a time and gathers what is typed meanwhile into the next one, so a fast typist or a paste
  costs a few requests, never a reordered command. Resizes go through the same queue, and only the
  latest size waiting is sent: dragging the sheet's edge does not replay every intermediate size. A
  paste is cut into 64 KiB requests, never inside a surrogate pair.
- **Keepalive.** An idle shell writes nothing, and nginx or Traefik end a response silent for 60 s,
  which would close the session. The server writes a NUL byte every 30 s, which the terminal ignores.
- A session belongs to the user who opened it: an id from someone else's reads as missing.
- Bounds, checked with zod: `cols` and `rows` between 1 and 1000, `input` up to 64 KiB (a large paste).

## Server

Two classes, so the sessions serve any shell (see [the host terminal](host-terminal.md)):

- `TerminalSessions` (`#libs/terminals`, its instance in `#libs/terminals/server`) holds the live sessions
  by id: their owner, the heartbeat, writing and resizing, and closing. A container's goes through `open`,
  and ends with its client; the host's goes through `attach`, and is kept for the next one (see
  [the host terminal](host-terminal.md#session)).
- `ContainerShells` (`#libs/docker`, bound with the `docker` instance in `#libs/docker/server`) starts a
  shell in a container and hands it over as a `TerminalShell`: its TTY stream, how to resize it, how to end
  it.

The route opening a shell goes through `terminalStream` (`src/app/api`): the size checked, the session
opened as the route says (the shell started, then `terminals.open` or `terminals.attach`), its TTY
streamed.

- **Open.** The container is looked up within the project, as for the logs, so an id from another app
  reads as missing. Then `exec` with `Tty`, stdin attached, `TERM=xterm-256color`, the initial
  `ConsoleSize`, and `sh -c 'command -v bash >/dev/null && exec bash || exec sh'`: bash when the image
  has it. A container with no `sh` (distroless) prints Docker's error in the terminal and the stream
  ends.
- **Close.** When the reader goes away (the request signal aborts), the shell exits, or **Fermer la
  session** asks for it.

  Closing the hijacked socket does **not** end the shell — verified against Docker 29: `sh`, and a `vi`
  started from it, keep running in the container after both `end()` and `destroy()`. Every shell's
  exec therefore carries `HANGAR_TERMINAL=<marker>`, a random id, in its environment, which its children inherit, and
  closing runs a second exec that sends `SIGHUP` to every process of the container carrying it (read
  from `/proc/*/environ`, with nothing but `sh` and `cat`). A container that stopped meanwhile has
  nothing left to kill; that failure is logged, not thrown.

- In memory only: Hangar is one process, and a session does not survive it.

## UI

- A running container's row opens a `ContainerConsoleSheet` (`modules/apps`), whose trigger reads
  "Console": two tabs, **Logs** and **Terminal**. A stopped container keeps the plain `LogsSheet`:
  Docker runs no exec in it. Both sheets share `LogsPanel` (`modules/common`). The terminal's client
  half (`TerminalPanel`, `useTerminal`, `TerminalView`, `TerminalOutbox`) sits in `modules/common` too,
  shared with the host's terminal.
- The shell opens the first time the Terminal tab is selected, and lives until the sheet closes: both
  tabs stay mounted, so a glance at the logs does not kill a running command, and coming back to them
  does not reload the tail. The fit addon skips a hidden element (its size reads `auto`), and refits
  on return.
- The terminal panel: a status badge (the logs' labels), a **Reconnecter** button, a **Fermer la
  session** button while connected, and the terminal filling the rest of the sheet, refitted by a
  `ResizeObserver`; each new size is sent to the session.
- `TerminalPanel` is a `React.lazy` chunk, fetched when the tab first opens: xterm, its stylesheet and
  the client half of the protocol stay off every app page, and off the server render (xterm touches
  `window` on load). The client half (`TerminalProtocol`: header name, session URL, input limit) is
  apart from the zod schemas (`TerminalMessages`), which only the routes load.
- When the shell exits, the terminal stops sending: what is typed afterwards has no session to go to.
- Font: the app's JetBrains Mono, awaited before xterm measures its cells. Colors: the theme's
  background and foreground, read from the CSS variables when the terminal opens; switching theme
  meanwhile takes a reconnect.

## Security

A shell in a container is, for most images, root in that container, and through a mounted Docker socket
or host path possibly more. It is open to any signed-in user, like the compose operations already are:
Hangar has no roles. No command is logged, only the opening and closing of a session, with the user,
project and container.

## Tests

- `TerminalSessions`, against a fake shell: a session answers its owner only, writing and resizing reach
  the shell, an idle stream gets its heartbeat, the client leaving (even while the shell started) ends the
  shell and forgets the session, the shell exiting forgets it too.
- `ContainerShells`, against a fake Dockerode: opening scopes the container to its project, resizing
  reaches the exec, ending runs the kill exec with the shell's marker.
- Both routes: 401 before anything opens, 404 for a missing container or session, the stream with its
  id header and the request signal handed down, 400 for a body out of bounds. `DELETE` closes a session
  as its owner.
- `TerminalOutbox`: one request in flight at a time, what is typed meanwhile sent together and in order,
  only the latest size, a large paste cut outside surrogate pairs.
