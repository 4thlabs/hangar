# Spec: Docker Swarm

- **Status:** Draft
- **Date:** 2026-10-10
- **Owner:** Thomas

## Goal

See the Swarm cluster Hangar's host belongs to: its nodes, and the apps running on each of them. Do the few
operations a homelab needs, deploy store apps to the swarm from a `compose.swarm.yml`, and keep an encrypted
backup of the cluster's keys.

Out of scope: managing services one by one (scale, rollback), restoring from the UI, and the image update
check and nightly auto-update for Swarm apps (they cover compose apps only; v1 redeploys by hand).

## What Hangar can see

Hangar talks to its own daemon only (`/var/run/docker.sock`). On a manager, that daemon answers for the whole
cluster:

| Call                   | Gives                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `info.Swarm`           | Whether this node is in a swarm, its role, the cluster id          |
| `GET /nodes`           | Every node: hostname, role, leader, status, availability, CPU, RAM |
| `GET /services`        | Every service, its stack, and its desired replicas                 |
| `GET /tasks`           | Every Swarm task and the node it runs on                           |
| `GET /swarm`           | The join tokens                                                    |
| `GET /swarm/unlockkey` | The unlock key, when autolock is on                                |

A worker gets `503` on all of them except `info`: the page then only says "this node is a worker of cluster
X" and shows the command to run on a manager.

**Compose and Swarm stay apart.** Compose apps run on Hangar's node and live in `/apps`, unchanged. An app
that should run on another machine is deployed to the swarm from its `compose.swarm.yml` (see below). `/cluster` shows only what runs in the swarm: the Swarm tasks from `GET /tasks`, with their
node. It never lists compose containers, even on Hangar's node, and `/apps` never lists Swarm tasks.

Swarm tasks are grouped into one app per stack (`com.docker.stack.namespace`), or per service when the
service is not part of a stack. A stack Hangar deployed is named after the app id, so it maps back to its
store app.

## Swarm apps in the store: `compose.swarm.yml`

An app that can run in the swarm has a `compose.swarm.yml` next to its `compose.yml`. It only adds what Swarm
needs; everything else is inherited from `compose.yml` by Swarm's own multi-file merge:

```bash
docker stack deploy -c compose.yml -c compose.swarm.yml miniflux
```

Example: Miniflux and its Postgres database.

```yaml
# store/miniflux/compose.yml: what /apps runs with docker compose, and the base of the stack
x-hangar:
  name: Miniflux # display name, moved out of the top-level `name`
  icon: https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/miniflux.webp
services:
  miniflux:
    image: miniflux/miniflux:2.2.10
    container_name: miniflux # ignored by Swarm
    restart: unless-stopped # ignored by Swarm
    depends_on: [db] # list form: Swarm rejects `condition: service_healthy`
    env_file: miniflux.env
    environment:
      DATABASE_URL: postgres://miniflux:${MINIFLUX_DB_PASSWORD}@db/miniflux?sslmode=disable
      ADMIN_PASSWORD: ${MINIFLUX_ADMIN_PASSWORD}
    labels:
      - traefik.enable=true
      - traefik.http.routers.miniflux.rule=Host(`miniflux.${DOMAIN}`)
    networks: [default, proxy]

  db:
    image: postgres:17-alpine
    container_name: miniflux-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: miniflux
      POSTGRES_PASSWORD: ${MINIFLUX_DB_PASSWORD}
    volumes:
      - ${APP_DATA_DIR}/miniflux/db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "miniflux"]
      interval: 10s

networks:
  proxy:
    name: hangar-proxy-net # Traefik's bridge network under compose
    external: true
```

```yaml
# store/miniflux/compose.swarm.yml: only what Swarm adds or changes
services:
  miniflux:
    deploy:
      replicas: 2
      labels: # Traefik's Swarm provider reads these, not the container labels
        - traefik.enable=true
        - traefik.http.routers.miniflux.rule=Host(`miniflux.${DOMAIN}`)
        - traefik.http.services.miniflux.loadbalancer.server.port=8080
      update_config:
        order: start-first # update without downtime

  db:
    deploy:
      placement:
        constraints: [node.hostname == nas] # its data lives on the nas

networks:
  proxy:
    name: hangar-proxy-overlay # Traefik's overlay network in the swarm
    external: true
```

The merged stack keeps the image, environment, `env_file`, volume and healthcheck from `compose.yml`, adds
the `deploy:` blocks, and points `proxy` at the overlay network instead of the bridge. The stack's `default`
network becomes an overlay on its own, so the two `miniflux` replicas reach `db` from any node.

What this rests on, checked with `docker stack config` on Docker 29.1.3:

| Fact                                                                                                                                     | Consequence                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker stack deploy` has no `--env-file`; it interpolates `${VAR}` from its own process environment                                     | Hangar runs it with `.env.global` parsed into the child process's `env`. By hand: `set -a; . .env.global; set +a` first                                                        |
| A top-level `name` is rejected ("Additional property name is not allowed"); `x-*` keys are accepted                                      | The display name moves to `x-hangar.name` (see below)                                                                                                                          |
| `extends` is rejected ("forbidden properties"), and `!reset` is not understood: `!reset null` silently becomes the string `"null"`       | No per-service opt-in: the stack is always `compose.yml` + `compose.swarm.yml`. Keys Swarm does not support (`container_name`, `restart`) are left in place and ignored        |
| `depends_on` must be a list ("services.miniflux.depends_on must be a list"): the long form with `condition: service_healthy` is rejected | A swarm-capable `compose.yml` writes `depends_on: [db]`, and loses compose's wait for a healthy database. Swarm ignores `depends_on` anyway: the app must retry its connection |

- **Display name:** Hangar reads `x-hangar.name`, falling back to the top-level `name`, then to the
  capitalized folder name. The top-level `name` is already only a label, since the compose project is always
  `-p <app>`. Only the apps that get a `compose.swarm.yml` need to move it.
- **Validation:** `compose.swarm.yml` is edited in the store editor like any other file of the app
  (#107). Before it is written, the editor runs `docker stack config -c compose.yml
-c compose.swarm.yml` with the same environment, which works on any node, swarm or not. Saving the
  `compose.yml` of an app that has a `compose.swarm.yml` runs the same check too, since an edit there (a
  top-level `name`, a `depends_on` condition) can break the stack.
- **Compose or Swarm, never both:** an app listed under `swarm:` in `hangar.yml` runs in the swarm; any other
  installed app runs with compose. `HangarStore.compose` skips the `swarm:` apps, so `store up` never starts
  a second copy, and `HangarStore.stack` only addresses them. See [the open question](#open-questions).
- **Where it shows:** the store card of an app with a `compose.swarm.yml` gets a "Swarm" badge, and
  "Déployer sur le swarm" next to "Installer". A deployed stack appears on `/cluster`, never on `/apps`.
- **Volumes:** a bind mount such as `${APP_DATA_DIR}/miniflux/db` must exist on whichever node runs the task.
  Hangar does not copy data between nodes. Three ways, all in `compose.swarm.yml`; see below.

### Volumes in the swarm

A volume in `compose.swarm.yml` replaces the one of `compose.yml` that has the same target path (checked with
`docker stack config`), so the data can move without touching `compose.yml`:

| Way               | When                                                      | `compose.swarm.yml`                                        |
| ----------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Pin the service   | The data stays on one node                                | `deploy.placement.constraints: [node.hostname == nas]`     |
| Override the path | A share is mounted at the same path on every node (fstab) | `volumes: [/mnt/nas/miniflux/db:/var/lib/postgresql/data]` |
| NFS volume        | Docker mounts the share itself, on whichever node runs it | a named volume with the `nfs` driver options, below        |

```yaml
# store/miniflux/compose.swarm.yml: the database on an NFS share instead of the nas's disk
services:
  db:
    volumes:
      - miniflux-db:/var/lib/postgresql/data # replaces ${APP_DATA_DIR}/miniflux/db
volumes:
  miniflux-db:
    driver: local
    driver_opts:
      type: nfs
      o: addr=${NFS_SERVER},nfsvers=4,rw
      device: :/export/miniflux/db
```

- `${NFS_SERVER}` comes from `.env.global`, like any other variable.
- The volume is created on each node the first time a task lands there; every node needs the NFS client
  (`nfs-common`).
- A database on NFS is sensitive to locking and `fsync`: prefer pinning for Postgres, SQLite and the like, and
  NFS for plain files (media, uploads, config).

**Alternatives considered:**

- **Render with Compose first** (`docker compose config`, which knows `--env-file`, `extends` and `!reset`,
  piped into `docker stack deploy -c -`): allows per-service inheritance, but adds a translation step between
  the file and what Swarm runs. Rejected: Swarm is used directly.
- **A standalone `compose.swarm.yml`** deployed alone (`-c compose.swarm.yml`): no inheritance, no `name`
  constraint on `compose.yml`, but the image, volumes and environment are written twice. Possible later as an
  opt-out (`x-hangar.swarm.inherit: false`) if one app needs it.

## Stack commands: `HangarStore.stack`, like `HangarStore.compose`

Nobody types `docker stack deploy -c … -c …` by hand. `#libs/hangar` gets the Swarm counterpart of the
compose helper, and both the UI's server actions and the CLI go through it:

| Compose (today)                                                                        | Swarm (new)                                                                                                |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `HangarStore.compose(name, args, options)`                                             | `HangarStore.stack(name, args, options)`                                                                   |
| `composeStack(app, args)`: `docker compose --env-file … -p <app> -f compose.yml …args` | `stackApp(app, args)`: builds the `docker stack` call below, with `.env.global` as the child's environment |
| `name`: a global command, a category or an app                                         | Same resolution, keeping only the `swarm:` apps                                                            |
| `HangarStore.CommandOrder`: `up` forwards, `down` backwards                            | `deploy` forwards, `rm` backwards, the rest in parallel                                                    |

`stackApp` maps a short verb to the full `docker stack` call, so the files and the stack name are never
written by the caller:

| Verb            | Runs                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `deploy [args]` | `docker stack deploy -c <app>/compose.yml -c <app>/compose.swarm.yml …args <app>`          |
| `config`        | `docker stack config -c <app>/compose.yml -c <app>/compose.swarm.yml` (the editor's check) |
| `rm`            | `docker stack rm <app>`                                                                    |
| `ps [args]`     | `docker stack ps …args <app>`                                                              |
| `services`      | `docker stack services <app>`                                                              |

- **Environment:** `RunOptions` gains `env?: Record<string, string>`, merged over `process.env` by
  `Runtime.run`. `stackApp` fills it from `HangarEnv.read()`; that is how `.env.global` reaches Swarm without
  an `--env-file`.
- **Errors:** targeting an app that is not a `swarm:` app, or has no `compose.swarm.yml`, fails with
  `HangarRuntimeError` ("<app> is not a swarm app"), as `composeStack` does for a missing `compose.yml`. A
  global or category target simply leaves the compose apps out.
- **Plain Node:** the helper only spawns `docker`, so `bin/cli.js` can use it (AGENTS.md § server-only).

### CLI: `swarm`

`src/cli/commands/swarm.ts`, the twin of `store.ts`, documented in `docs/cli.md`:

```bash
node bin/cli.js swarm deploy             # every `swarm:` app of hangar.yml, in category order
node bin/cli.js swarm miniflux deploy    # one app; extra args go to docker stack deploy
node bin/cli.js swarm Media rm           # a category, in reverse order
node bin/cli.js swarm miniflux ps        # docker stack ps miniflux
node bin/cli.js swarm ls                 # docker stack ls
```

## The page: `/cluster`

New entry "Cluster" in the navbar, next to "Apps". One grid of node cards, one card per node, the current
node first. Same tree on mobile, one column.

```
┌ Cluster ────────────────────────────────────────────────────────────────────────┐
│ nhyx6n1b8b0a · 3 nœuds · 2 managers (tolère 0 panne)  [Tokens]  [Sauvegarder]   │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ┌ nas  ★ ce nœud ──────────────┐ ┌ pi-01 ───────────────────┐ ┌ pi-02 ──────────┐ │
│ │ Leader · Prêt · Actif        │ │ Manager · Prêt · Actif   │ │ Worker · Injoi- │ │
│ │ 8 CPU · 32 Go · Docker 29.1  │ │ 4 CPU · 8 Go · 29.1      │ │ gnable · Drainé │ │
│ │──────────────────────────────│ │──────────────────────────│ │─────────────────│ │
│ │ ● miniflux     2 tâches      │ │ ● traefik      1 tâche   │ │ Aucune app      │ │
│ │ ◐ uptime-kuma  1 tâche       │ │ ● miniflux     1 tâche   │ │                 │ │
│ │──────────────────────────────│ │──────────────────────────│ │─────────────────│ │
│ │ [Drainer]                    │ │ [Rétrograder] [Drainer]  │ │ [Réactiver]     │ │
│ │                              │ │                          │ │ [Retirer]       │ │
│ └──────────────────────────────┘ └──────────────────────────┘ └─────────────────┘ │
│                                                                                   │
│ Dernière sauvegarde des clés : aujourd'hui 03:37 · [Télécharger]                  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- **Page header:** the cluster id's first 12 characters, as the `docker` CLI shortens ids: Swarm has no
  name of its own (`Spec.Name` is always `default`). Then the node and manager counts, and the fault
  tolerance.
- **Card header:** hostname, badges for role (Leader / Manager / Worker), status (Prêt / Injoignable) and
  availability (Actif / Drainé), then CPU, RAM and engine version from `GET /nodes`.
- **App list:** one line per stack (or lone service) with tasks on that node, and how many run there. A
  stack spread over several nodes shows on each of them (`miniflux` above). The dot is the stack's health
  across the cluster, with the `/apps` symbols: ● every desired replica runs, ◐ some, ○ none. Swarm only: the
  compose apps of Hangar's node are not repeated here.
- **Stack sheet:** clicking a stack opens a side sheet with its services and tasks per node
  (`HangarStore.stack(app, ["ps"])`), and, for a stack Hangar deployed, "Mettre à jour" (deploy again) and
  "Supprimer" (`rm`).
- **Actions:** promote / demote, drain / activate, remove (only once the node is down). Demoting the last
  manager is refused. Each action asks for a confirmation that states the fault tolerance after it.
- **Not in a swarm:** an empty state with "Créer le cluster" (`swarm init`) and "Rejoindre" (token + address).
- **Locked:** a manager restarted with autolock on stays `locked` until `docker swarm unlock`. The page says so
  and shows the command; Hangar never asks for the unlock key.
- **Tokens:** a dialog that shows the worker and manager join commands on click, with a "Régénérer" button.
- Live data comes from the existing Docker events stream: a `node` or `service` event refreshes the page.
  Docker emits no event per task, so task counts also follow a short cache TTL.

## Key backup

- **What:** the two join tokens, the unlock key when autolock is on, and the `swarm` directory (CA and Raft),
  the only part that rebuilds the same cluster after losing every manager. The directory comes last in the
  plan (step 5): until then a backup holds the tokens and the unlock key only. It is read through a container
  that is created with it bind-mounted read-only, never started, and removed after `getArchive`; Hangar needs
  no new mount.
- **Format:** one file, `HANGAR_DATA_DIR/swarm-backups/<date>.tar.age`, encrypted with
  [age](https://age-encryption.org) to the public key in a new optional variable,
  `HANGAR_SWARM_BACKUP_RECIPIENT`. Hangar can write a backup but never read it. Without the variable, backups
  are off and the page says so.
- **When:** a Sidequest job every night, plus the "Sauvegarder" button. The 14 newest files are kept. A
  failure sends a notification.
- **Restore:** by hand, documented in `docs/swarm.md`: decrypt with `age`, put `swarm/` back, run
  `docker swarm init --force-new-cluster`, rejoin the other nodes.

## Code layout

| Where                                           | What                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/libs/docker/swarm.ts`                      | `DockerSwarm` class: state, nodes, tasks per node, node updates, tokens                      |
| `src/libs/docker/swarm-backup.ts`               | `SwarmBackup` class: build, encrypt, write, prune                                            |
| `src/libs/jobs/jobs/back-up-swarm.ts`           | Nightly job                                                                                  |
| `src/libs/hangar/hangar-store.ts`               | `stack()` and `stackApp()` next to `compose()`, which skips `swarm:` apps; `x-hangar.name`   |
| `src/libs/hangar/runtime/runtime.ts`            | `RunOptions.env`                                                                             |
| `src/cli/commands/swarm.ts`                     | The `swarm` CLI command                                                                      |
| `src/libs/hangar/hangar-config.ts`              | The `swarm:` list in `hangar.yml`                                                            |
| `src/modules/cluster/`                          | Page components (`node-card.tsx`, `stack-sheet.tsx`, `tokens-dialog.tsx`) and server actions |
| `docs/cli.md`, `docs/store.md`, `docs/swarm.md` | The `swarm` CLI, `compose.swarm.yml` and `x-hangar.name`, the restore procedure              |
| `src/app/pages/(app)/cluster.tsx`               | Thin page shell                                                                              |

No database change. Reads go through `#libs/cache` under `docker:swarm:`, like the other Docker reads.

## Tests

- `DockerSwarm` against the existing Docker mock: grouping tasks per node, the worker and not-in-a-swarm
  states, refusing to demote the last manager.
- `HangarStore.stack` with a fake `CommandRunner`, as `compose` is tested: the exact `docker stack` argv per
  verb, `.env.global` in `env`, deploy order forwards and `rm` backwards, compose apps refused, and
  `compose()` skipping the `swarm:` apps.
- `HangarStore` display name: `x-hangar.name`, then `name`, then the folder name.
- `SwarmBackup` with a fake archive: the file decrypts with the test identity, pruning keeps 14.
- One manual drill before releasing step 5: back up a test cluster, restore it on a fresh VM.

## Plan

1. Read-only page: nodes and their apps.
2. Node actions, init / join, tokens.
3. Store: `compose.swarm.yml`, `HangarStore.stack` with the `swarm` CLI, "Déployer sur le swarm", and the
   stack sheet.
4. Key backup: tokens and unlock key, encryption, nightly job, download.
5. Raft directory in the backup, the restore doc, and the restore drill.

### Step 1: the read-only page

Branch `feat/swarm-cluster-page`. Nothing here writes to the daemon; the actions, `swarm init` and the
tokens come in step 2. A stack line is not clickable yet: the stack sheet reads `docker stack ps`, which
comes with `HangarStore.stack` in step 3.

**`DockerSwarm` (`src/libs/docker/swarm.ts`).** Built like `Docker`: `new DockerSwarm(dockerode, cache, ttl)`,
no `server-only` guard. One public read, `cluster()`, a union on `state`:

| `state`    | When (`info.Swarm`)                     | Carries                                                     |
| ---------- | --------------------------------------- | ----------------------------------------------------------- |
| `inactive` | `LocalNodeState` is `inactive`          | Nothing                                                     |
| `locked`   | `LocalNodeState` is `locked` (autolock) | Nothing; the page shows `docker swarm unlock`               |
| `worker`   | `active`, `ControlAvailable` false      | Cluster id, `RemoteManagers` for the command to run there   |
| `manager`  | `active`, `ControlAvailable` true       | Cluster id, current node id, fault tolerance, `SwarmNode[]` |

- `info()` comes first; `listNodes`, `listServices({ status: true })` and
  `listTasks({ filters: { "desired-state": ["running"] } })` are only called on a manager, so a worker never
  meets their `503`.
- A stack is `com.docker.stack.namespace`, or the service name outside a stack. Its health (● ◐ ○) comes from
  `ServiceStatus.RunningTasks` / `DesiredTasks` summed over its services, which also covers `global` services.
  A node lists the stacks with at least one `running` task on it, and how many.
- Fault tolerance is `floor((managers - 1) / 2)`.
- One cache key, `docker:swarm:cluster`, with a 10 s TTL: Docker emits no task events.
- `SwarmNode`: id, hostname, role, leader, status, availability, CPUs, memory, engine version, and its stacks
  (name, health, tasks running on that node).

**Events (`src/libs/docker/events.ts`).** `DockerChange` gains `"swarm"`. The filters add the `node` and
`service` types with `create`, `update` and `remove`, and a container event carrying
`com.docker.swarm.task.id` also counts as `"swarm"`. `cache.refresh` matches by prefix, so the existing
`docker:${change}` reload reaches `docker:swarm:cluster` with no other change.

**Composition root (`src/libs/docker/server/server.ts`).** One `Dockerode` client, shared by `docker` and a new
`swarm` export.

**Page (`src/modules/cluster/`).**

| File                                | What                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `components/cluster-content.tsx`    | Server half, `map` / `recover` around `swarm.cluster()`, as `AppsContent` does     |
| `components/cluster-overview.tsx`   | Header (nodes, managers, fault tolerance), the grid, `<AutoReload seconds={10} />` |
| `components/node-card.tsx`          | Role, status and availability badges; CPU, RAM, engine version; the stack list     |
| `components/cluster-empty.tsx`      | The `inactive`, `locked` and `worker` states, each with the command to copy        |
| `status.ts`                         | Labels and symbols, with the `/apps` conventions                                   |
| `src/app/pages/(app)/cluster.tsx`   | Thin shell, like `apps.tsx`                                                        |
| `src/modules/common/navigations.ts` | "Cluster" after "Apps", shown in every state                                       |

One grid, `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`: the current node first, then the managers, then by
hostname.

**Tests.**

- `swarm.test.ts`: the mock gains `listNodes`, `listServices` and `listTasks`, with `swarmNode()`,
  `swarmService()` and `swarmTask()` helpers. The four states, a stack over two nodes, a service outside a
  stack, a global service, partial health, fault tolerance, and no manager call on a worker.
- `events.test.ts`: node, service and task-container events report `"swarm"`.
- A component test rendering each state.
- By hand: a one-node swarm (`docker swarm init`) locally, then two or three `docker:dind` containers for a
  multi-node cluster.

## Open questions

1. **How an app is marked as running in the swarm.** Having a `compose.swarm.yml` only says it _can_.
   Recommended: a `swarm:` list of app ids in `hangar.yml`, next to `categories` (which still give the order).
   "Déployer sur le swarm" adds the app there, in the local clone, then deploys; "Supprimer" removes it.
   Alternative: the presence of `compose.swarm.yml` alone means Swarm, which forbids keeping a compose
   fallback for the same app.
