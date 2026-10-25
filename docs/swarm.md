# Docker Swarm

Hangar runs your apps with `docker compose` on its own host. If that host belongs to a
[Docker Swarm](https://docs.docker.com/engine/swarm/), the **Cluster** page shows the whole cluster:
its nodes, and the stacks running on them. From there you can create or join a swarm, change a node,
and deploy the store apps that ship a `compose.swarm.yml`.

Compose and Swarm are independent. An app can run with compose on Hangar's host, in the swarm, or both,
and deploying one way never touches the other. `/apps` lists the compose projects only, `/cluster` the
Swarm stacks, and the installed apps you can deploy there.

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

One card per node: its role (leader, manager, manager outside Raft, or worker), its status, its
availability, its CPUs, memory, Docker version, how many tasks run on it, and its labels. The node Hangar runs on is marked **★ ce nœud**. The title
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
| **Retirer**     | `docker node rm`                           | The node is not ready, and not a manager in the Raft group                      |

A few things Swarm itself decides:

- A manager cannot be removed: demote it first.
- A promotion only records the wish: a node promoted while out of reach never joins the managers'
  Raft group, and the daemon refuses to demote it. `docker node ls` leaves its manager status blank;
  Hangar marks it **Manager hors Raft**, offers **Retirer** instead once it is not ready, and leaves it
  out of the manager count and the fault tolerance.
- A node reads as down about 15 seconds after it stops answering. Only once it is no longer ready can
  it be removed; it must rejoin with a token if it comes back. Still ready, drain it so no task lands
  there, then run `docker swarm leave` on its host.
- Demoting the node Hangar runs on costs Hangar its view of the cluster. The confirmation warns you.
- Right after a promotion, the daemon refuses a demotion for a couple of seconds, until the Raft group
  settles. Try again.

### Node labels

A placement constraint can pick nodes by label rather than by hostname, so the stack follows the
disk or the GPU when the machine is renamed or replaced. Each card has a **Labels** button to add,
change and drop them, as `docker node update --label-add` and `--label-rm` would:

```yaml
# compose.swarm.yml
deploy:
  placement:
    constraints: [node.labels.storage == nas] # any node labelled storage=nas
```

- A key is letters, digits, `.`, `_` and `-`: the only keys a constraint can name. A value is one line,
  and may be empty, though `==` cannot match an empty value.
- Only what you changed is sent, over the labels the daemon has at that moment: a label added from the
  CLI meanwhile is kept.
- A node that is down can be labelled too: its labels live with the managers.
- The card also shows, with a server icon, the labels the host sets in its `daemon.json`
  (`"labels": ["arch=arm64"]`). Constraints read them as `engine.labels.<key>`; only the host changes
  them, and `systemctl reload docker` picks the change up.

### Stacks

The table lists every stack of the swarm, deployed by Hangar or not: its health, its running and
desired replicas, and the nodes its tasks run on, with how many on each. A stack whose tasks run
nowhere stays listed, so you can see why. Every installed app that has a `compose.swarm.yml` is listed
too, as **Non déployée** (◌) until it runs in the swarm, as `/apps` lists an app never started.

As on `/apps`, the navbar search finds a stack by name, the column headers sort, and three menus
filter: **Origine** (the stacks of your store apps, or the others), **Nœud** and **Santé**. The filters
live in the URL, so a filtered view can be bookmarked.

Clicking a stack opens its tasks, node by node, with the past attempts and the error Docker gives for
each failed one. One **Logs** button per service follows its output, every task on every node, from the
last 200 lines: each line names its task and node, as `docker service logs` does (`miniflux_web.2@pi-01 |`).
The daemon must still hold the logs, as with the default `json-file` driver, `local` or `journald`. A stack named after an installed store app that has a `compose.swarm.yml` carries a
**Hangar** badge, and its sheet adds **Déployer** while it runs nowhere, then **Mettre à jour**
(`docker stack deploy` again, which resolves the images anew and rolls the services that changed) and
**Supprimer** (`docker stack rm`). A deploy shows Docker's output live in the sheet; closing the sheet
does not stop it, and a notification says how it ended. Removing the stack keeps the app installed and
its volumes on disk: it goes back to **Non déployée**.

The page reloads every 10 seconds: Docker emits no event when a task starts or stops.

## Deploy an app to the swarm

### The overlay network

The compose apps share bridge networks such as `hangar-main-net`, which Hangar's own
`compose.yml`, at the root of this repository, creates. A bridge only reaches its own host, so the
stacks share an overlay network instead, created once on a manager:

```bash
docker network create -d overlay --attachable hangar-overlay-net
docker network ls --filter name=hangar-overlay-net # DRIVER overlay, SCOPE swarm
```

A stack joins it as an `external` network, from its `compose.swarm.yml` (below). `--attachable` also
lets a plain container join it, such as a Traefik run with compose on a node of the swarm: without it,
only Swarm services can.

Hangar's `compose.yml` does not create it: Docker creates an overlay only on a manager, and Hangar must
start outside a swarm too.

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
    name: hangar-overlay-net # the overlay network, created once: see above
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

| Way               | When                                                      | In `compose.swarm.yml`                                                                   |
| ----------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Pin the service   | The data stays on one node                                | `deploy.placement.constraints: [node.labels.storage == nas]` or `[node.hostname == nas]` |
| Override the path | A share is mounted at the same path on every node (fstab) | `volumes: [/mnt/nas/miniflux/db:/var/lib/postgresql/data]`                               |
| NFS volume        | Docker mounts the share itself, wherever the task runs    | a named volume with the `nfs` driver options, below                                      |

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

- **From the Cluster page.** Install the app from the store as any other (its card shows a **Swarm**
  badge): it then shows in the stack table as **Non déployée**. Its sheet's **Déployer** runs
  `docker stack deploy` and streams its output. Its compose project, if any, is left as it is.
- **From the CLI**, against a manager: `node bin/cli.js swarm miniflux deploy`, or `swarm deploy` for every
  app that has a `compose.swarm.yml`, in category order. See [the CLI](cli.md#swarm-target-verb-args).
- **By hand**, with `docker stack deploy` and the commands above.

Hangar's deploy waits for the services to run (`--detach=false`): it ends once every replica is up, so
pulls on every node make it take a while. From the CLI, `swarm miniflux deploy --detach=true` returns as
soon as the services are updated.

Uninstalling the app from the store takes down both its compose project and its stack.

## A node on WSL

A Windows machine can join the swarm through WSL 2 with `networkingMode=mirrored` in
`%UserProfile%\.wslconfig`: WSL then shares the Windows host's address on the LAN, and the node
advertises it. Three things break that worked under the default NAT mode.

### The Hyper-V firewall blocks the swarm ports

In mirrored mode the Hyper-V firewall filters inbound traffic to WSL, and blocks it by default
(`DefaultInboundAction: Block`). The node still reaches the managers, so it joins, but they cannot
reach it back: `journalctl -u docker` on WSL logs `Bulk sync to node … timed out` every 30 seconds,
and its tasks never start. Open the swarm ports from an elevated PowerShell on Windows:

```powershell
$wsl = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' # WSL's VMCreatorId
$rules = @(
  @{ Name = 'Swarm-2377-TCP'; DisplayName = 'Swarm manager TCP';   Protocol = 'TCP'; LocalPorts = 2377 },
  @{ Name = 'Swarm-7946-TCP'; DisplayName = 'Swarm gossip TCP';    Protocol = 'TCP'; LocalPorts = 7946 },
  @{ Name = 'Swarm-7946-UDP'; DisplayName = 'Swarm gossip UDP';    Protocol = 'UDP'; LocalPorts = 7946 },
  @{ Name = 'Swarm-4789-UDP'; DisplayName = 'Swarm overlay VXLAN'; Protocol = 'UDP'; LocalPorts = 4789 }
)
foreach ($rule in $rules) {
  Remove-NetFirewallHyperVRule -Name $rule.Name -ErrorAction SilentlyContinue
  New-NetFirewallHyperVRule @rule -Direction Inbound -VMCreatorId $wsl -Action Allow | Out-Null
}
```

The script can run again: it replaces the rules. Port 2377 only matters once the node is promoted to
manager. `Get-NetFirewallHyperVRule -VMCreatorId $wsl` lists the rules, without elevation.

### NFS volumes need `noresvport`

The kernel's NFS client connects from a reserved source port (below 1024) by default, and in mirrored
mode those connections do not get out. The task then stays in **Starting**, and
`docker service ps --no-trunc <stack>_<service>` on a manager reads
`failed to mount local volume: … connection timed out`. Add `noresvport` to the volume's options:

```yaml
volumes:
  miniflux-db:
    driver: local
    driver_opts:
      type: nfs
      o: addr=${NFS_SERVER},nfsvers=4,rw,noresvport
      device: :/export/miniflux/db
```

The server must accept unprivileged ports, as it already does if the node mounted the share under NAT,
where Windows rewrote the port. A volume keeps the options it was created with: remove it on the WSL
node (`docker volume rm <stack>_<volume>`) before deploying again.

### The overlay needs TX checksum offload off

The task runs, but a reverse proxy on another node answers **Gateway Timeout**: the overlay carries
nothing between the WSL node and the others. The kernel leaves the outer UDP checksum of VXLAN packets
to the NIC, the mirrored virtual NIC does not fill it in, and the peer drops them. Compute it in the
kernel instead:

```bash
sudo ethtool -K eth0 tx off
```

The setting does not survive `wsl --shutdown`. With `systemd=true` in `/etc/wsl.conf`, a unit applies
it before Docker starts:

```ini
# /etc/systemd/system/eth0-tx-off.service
[Unit]
Description=Disable TX checksum offload on eth0 (VXLAN in mirrored mode)
Before=docker.service
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/sbin/ethtool -K eth0 tx off

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable eth0-tx-off.service
```

Traffic did not flow back at once: the peer's replies reached Windows and were forwarded to WSL
without a drop, but only started reaching `eth0` about three minutes after the change. The cause of
that delay is not known; give it a few minutes before looking elsewhere.

### Diagnose a WSL node

Which node to look from, and what each command tells:

| Where        | Command                                                     | Tells                                                         |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------------- |
| A manager    | `docker service ps --no-trunc <stack>_<service>`            | Each task's node, state and error (a mount that timed out)    |
| The WSL node | `journalctl -u docker -f`                                   | Gossip (`Bulk sync … timed out`), raft and mount errors       |
| The WSL node | `docker ps -a --filter label=com.docker.swarm.service.name` | The tasks that landed there; one stuck in `Created` never ran |
| The WSL node | `ethtool -k eth0 \| grep tx-checksumming`                   | `off` once the overlay fix applies                            |
| Windows      | `Get-NetFirewallHyperVRule -VMCreatorId $wsl`               | The swarm rules are there                                     |

`docker service logs` stays empty for a task that never started: the manager asks the node for the
logs of a container that has none.

**Is the overlay up?** Ping a container on another node from a throwaway container on the WSL node, on
an attachable overlay network:

```bash
docker run --rm --network <overlay> busybox:1.36 sh -c 'nslookup <service> 127.0.0.11; ping -c 3 <service>'
```

**Where are the VXLAN packets lost?** Capture UDP 4789 on both ends while that ping runs. No need to
install tcpdump, the `netshoot` image carries it:

```bash
docker run --rm --net=host --cap-add NET_ADMIN --cap-add NET_RAW nicolaka/netshoot:v0.13 \
  timeout 15 tcpdump -ni any -vv 'udp port 4789'
```

| What the captures show                                          | Where it breaks                                       |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| Packets leave WSL, none reach the peer                          | Windows, on the way out                               |
| The peer receives them with `bad udp cksum`, and does not reply | The checksum: turn TX offload off                     |
| The peer replies, nothing comes back on WSL's `eth0`            | Windows, on the way in: trace it with `pktmon`, below |

A `bad udp cksum` on the sending side alone means nothing: with offload on, the capture sees the packet
before the NIC fills the checksum in.

**What does Windows do with them?** `pktmon` follows a packet through every Windows network component
and records drops. From an elevated PowerShell:

```powershell
pktmon filter remove
pktmon filter add VXLAN -t UDP -p 4789
pktmon start --capture --pkt-size 0 --file-name "$env:TEMP\vxlan.etl"
Start-Sleep -Seconds 10
pktmon stop
pktmon etl2txt "$env:TEMP\vxlan.etl" --out "$env:TEMP\vxlan.txt"
pktmon filter remove
```

A packet that reaches WSL ends on the `vmswitch.sys` component of WSL's virtual switch; a dropped one
logs a drop with its reason.

## Not covered yet

- The image update check and the nightly auto-update cover compose apps only. Update a stack with
  **Mettre à jour**, or `swarm <app> deploy`.
- Services are not managed one by one: no scaling or rollback from the UI. Change `replicas` in
  `compose.swarm.yml` and deploy again.
- Backing up the cluster's keys and the Raft state is planned; see the
  [spec](specs/docker-swarm.md).
