# Docker Swarm

Hangar runs your apps with `docker compose` on its own host. If that host belongs to a
[Docker Swarm](https://docs.docker.com/engine/swarm/), the **Cluster** page shows the whole cluster:
its nodes, and the stacks running on them. From there you can create or join a swarm, change a node,
and deploy the store apps that ship a `compose.swarm.yml`.

Compose and Swarm are independent. An app can run with compose on Hangar's host, in the swarm, or both,
and deploying one way never touches the other. `/apps` lists the compose projects only, `/cluster` the
Swarm stacks only.

## What Hangar needs

Hangar talks to the daemon of its own host through `/var/run/docker.sock`, as for compose. Only a
manager answers for the whole cluster, so **run Hangar on a manager**. On a worker, the Cluster page
only says so, with the managers' addresses and the command to run on one of them (`docker node ls`).

Nothing else changes in the [container setup](getting-started.md#run-the-container): Hangar itself
stays a compose container, not a Swarm service.

## The Cluster page

### Create or join a swarm

On a host that is in no swarm, the page offers two forms:

- **Créer le cluster** runs `docker swarm init`: this host becomes the first manager.
- **Rejoindre un cluster** runs `docker swarm join` with a manager's address (`192.168.1.10:2377`) and
  a join token.

Both take an optional **advertised address**, the IP or interface (`eth0`) the other nodes reach this
one on. Leave it empty unless the host has several addresses and Docker cannot pick one.

Other states read as such: a node joining shows a waiting message, and a manager locked by
[autolock](https://docs.docker.com/engine/swarm/swarm_manager_locking/) after a restart asks for
`docker swarm unlock` on the host.

### Add a node

**Tokens** shows the two join commands, one for a worker and one for a manager, with a copy button.
Run one on the machine to add. The commands carry the tokens, and anyone who has one can add a node to
the cluster: the page reads them only when you ask, and forgets them when the dialog closes.
**Régénérer** rotates a token. The old one stops working, and nodes already in the cluster are not
affected.

### Nodes

One card per node: its role (leader, manager or worker), its status, its availability, its CPUs, memory,
Docker version, and how many tasks run on it. The node Hangar runs on is marked **★ ce nœud**. The title
line sums up the cluster and how many manager failures it tolerates: with 3 managers it survives 1, with
5 it survives 2, and with 1 or 2 none.

The card offers the actions that apply to the node, each behind a confirmation that states what the
fault tolerance becomes:

| Action          | Runs                                       | Offered when                                                                    |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| **Promouvoir**  | `docker node promote`                      | The node is a worker                                                            |
| **Rétrograder** | `docker node demote`                       | The node is a manager, and another manager remains                              |
| **Drainer**     | `docker node update --availability drain`  | The node takes tasks: they move to the other nodes, and none is scheduled there |
| **Réactiver**   | `docker node update --availability active` | The node is drained or paused                                                   |
| **Retirer**     | `docker node rm`                           | The node is a worker and is down                                                |

A few things Swarm itself decides:

- A manager cannot be removed: demote it first.
- A worker reads as down about 15 seconds after it stops answering. Only then can it be removed; it
  must rejoin with a token if it comes back.
- Demoting the node Hangar runs on costs Hangar its view of the cluster. The confirmation warns you.
- Right after a promotion, the daemon refuses a demotion for a couple of seconds, until the Raft group
  settles. Try again.

### Stacks

The table lists every stack of the swarm, deployed by Hangar or not: its health, its running and
desired replicas, and the nodes its tasks run on, with how many on each. A stack whose tasks run
nowhere stays listed, so you can see why.

As on `/apps`, the navbar search finds a stack by name, the column headers sort, and three menus
filter: **Origine** (the stacks of your store apps, or the others), **Nœud** and **Santé**. The filters
live in the URL, so a filtered view can be bookmarked.

Clicking a stack opens its tasks, node by node, with the past attempts and the error Docker gives for
each failed one. A stack named after an installed store app that has a `compose.swarm.yml` carries a
**Hangar** badge, and its sheet adds **Mettre à jour** (`docker stack deploy` again, which resolves the
images anew and rolls the services that changed) and **Supprimer** (`docker stack rm`). Removing the stack keeps the app
installed and its volumes on disk.

The page reloads every 10 seconds: Docker emits no event when a task starts or stops.

## Deploy an app to the swarm

### `compose.swarm.yml`

An app runs in the swarm when its folder has a non-empty `compose.swarm.yml` next to its `compose.yml`.
Nothing in `hangar.yml` marks it. The file only holds what Swarm adds or changes: Swarm merges it over
`compose.yml` itself, so the image, environment and volumes are written once.

```bash
docker stack deploy -c compose.yml -c compose.swarm.yml miniflux
```

Take Miniflux and its Postgres database. Its `compose.yml` is what `/apps` runs with compose, and the
base of the stack:

```yaml
# store/miniflux/compose.yml
x-hangar:
  name: Miniflux # not a top-level `name`: Swarm rejects it
  icon: https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/miniflux.webp
services:
  miniflux:
    image: miniflux/miniflux:2.2.10
    container_name: miniflux # ignored by Swarm
    restart: unless-stopped # ignored by Swarm
    depends_on: [db] # the list form: Swarm rejects `condition: service_healthy`
    environment:
      DATABASE_URL: postgres://miniflux:${MINIFLUX_DB_PASSWORD}@db/miniflux?sslmode=disable
      RUN_MIGRATIONS: 1
    labels:
      - traefik.enable=true
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

Its `compose.swarm.yml` adds the replicas, Traefik's labels where its Swarm provider reads them, a
placement for the database, and swaps the bridge network for an overlay:

```yaml
# store/miniflux/compose.swarm.yml
services:
  miniflux:
    deploy:
      replicas: 2
      labels: # Traefik's Swarm provider reads the service labels, not the container ones
        - traefik.enable=true
        - traefik.http.routers.miniflux.rule=Host(`miniflux.${DOMAIN}`)
        - traefik.http.services.miniflux.loadbalancer.server.port=8080
      update_config:
        order: start-first # start the new task before stopping the old one: no downtime

  db:
    deploy:
      placement:
        constraints: [node.hostname == nas] # its data lives on the nas's disk

networks:
  proxy:
    name: hangar-proxy-overlay # an overlay network, created once with docker network create -d overlay
    external: true
```

The stack keeps everything from `compose.yml` and adds the `deploy:` blocks. Its `default` network
becomes an overlay on its own, so both `miniflux` replicas reach `db` from any node. Check the merged
result with `node bin/cli.js swarm miniflux config` (see [the CLI](cli.md#swarm-target-verb-args)).

### What Swarm accepts

- **No top-level `name`.** Move the display name to `x-hangar.name`, which Hangar reads first.
- **`depends_on` as a list.** The long form with `condition: service_healthy` is rejected, and Swarm
  ignores the order anyway: the app must retry its connection to the database.
- **No `extends`, no `!reset`.** The stack is always `compose.yml` plus `compose.swarm.yml`.
- **`container_name` and `restart` are ignored.** Leave them for compose; `deploy.restart_policy` is the
  Swarm counterpart.
- **No `--env-file`.** `docker stack deploy` takes `${VAR}` from its own environment: Hangar hands it
  `.env.global`. By hand, load it first: `set -a; . <data>/.env.global; set +a`.

The store editor checks both files with `docker stack config` before it writes either of them, so a
`compose.yml` edit that would break the stack is refused too.

### Volumes

A bind mount such as `${APP_DATA_DIR}/miniflux/db` must exist on whichever node runs the task, and
Hangar copies no data between nodes. A volume in `compose.swarm.yml` replaces the one of `compose.yml`
with the same target path, so the choice stays in the Swarm file:

| Way               | When                                                      | In `compose.swarm.yml`                                     |
| ----------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Pin the service   | The data stays on one node                                | `deploy.placement.constraints: [node.hostname == nas]`     |
| Override the path | A share is mounted at the same path on every node (fstab) | `volumes: [/mnt/nas/miniflux/db:/var/lib/postgresql/data]` |
| NFS volume        | Docker mounts the share itself, wherever the task runs    | a named volume with the `nfs` driver options, below        |

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

Every node then needs the NFS client (`nfs-common`). A database on NFS is sensitive to locking and
`fsync`: pin Postgres, SQLite and the like, and keep NFS for plain files such as media and uploads.

If the app also runs with compose, both copies see the same bind mounts. Two databases writing the same
directory corrupt it: give the Swarm copy its own volume, or run only one at a time.

### Deploy it

Three ways, all naming the stack after the app id:

- **From the store.** The card of an app with a `compose.swarm.yml` shows a **Swarm** badge and a
  **Déployer sur le swarm** button. It installs the app if needed (link, `.env.global` variables), then
  runs `docker stack deploy`. Its compose project, if any, is left as it is.
- **From the CLI**, against a manager: `node bin/cli.js swarm miniflux deploy`, or `swarm deploy` for every
  app that has a `compose.swarm.yml`, in category order. See [the CLI](cli.md#swarm-target-verb-args).
- **By hand**, with `docker stack deploy` and the commands above.

The stack then shows on the Cluster page. Uninstalling the app from the store takes down both its
compose project and its stack.

## Not covered yet

- The image update check and the nightly auto-update cover compose apps only. Update a stack with
  **Mettre à jour**, or `swarm <app> deploy`.
- Services are not managed one by one: no scaling or rollback from the UI. Change `replicas` in
  `compose.swarm.yml` and deploy again.
- Backing up the cluster's keys and the Raft state is planned; see the
  [spec](specs/docker-swarm.md).
