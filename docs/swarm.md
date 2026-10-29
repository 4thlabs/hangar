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
too, as **Non déployée** (◌) until it runs in the swarm, as `/apps` lists an app never started. With
**Non installées** turned on, the store apps with a `compose.swarm.yml` that are not installed get a row
as well, marked **Non installée**, with **Installer** at its end.

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
- **No `deploy.resources.reservations.devices`.** Swarm ignores compose's GPU syntax: reserve a GPU as
  a generic resource instead, see [GPUs](#gpus).

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

### GPUs

A Swarm service cannot ask for a GPU the way a compose container does. The node advertises its GPUs as
generic resources, the service reserves one, and the NVIDIA runtime turns the reservation into a device
in the container. Three steps, the first two on every GPU node.

**1. Advertise the GPU** in `/etc/docker/daemon.json`. Swarm cannot pick a service's runtime, so
`nvidia` becomes the default:

```json
{
  "runtimes": {
    "nvidia": { "args": [], "path": "nvidia-container-runtime" }
  },
  "default-runtime": "nvidia",
  "node-generic-resources": ["NVIDIA-GPU=GPU-<uuid>"]
}
```

One `NVIDIA-GPU=<uuid>` entry per card; `nvidia-smi --query-gpu=name,uuid --format=csv` lists them.

**2. Let the runtime read the reservation.** Swarm hands the reserved GPU to the container as
`DOCKER_RESOURCE_<KIND>`, the kind in upper case. In `/etc/nvidia-container-runtime/config.toml`:

```toml
swarm-resource = "DOCKER_RESOURCE_NVIDIA-GPU"
```

Then `sudo systemctl restart docker`, which restarts the node's containers.

**3. Reserve it** in `compose.swarm.yml`:

```yaml
# store/llama-cpp/compose.swarm.yml
services:
  llama-cpp:
    deploy:
      resources:
        reservations:
          generic_resources:
            - discrete_resource_spec:
                kind: NVIDIA-GPU
                value: 1
```

The reservation is a placement rule too: Swarm schedules the task only on a node with a free GPU, so no
constraint is needed.

To check it:

| Where        | Command                                                                                  | Expect                             |
| ------------ | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| A manager    | `docker node inspect <node> --format '{{json .Description.Resources.GenericResources}}'` | The GPU's `NVIDIA-GPU` entry       |
| The GPU node | `docker exec <container> env \| grep DOCKER_RESOURCE`                                    | `DOCKER_RESOURCE_NVIDIA-GPU=GPU-…` |
| The GPU node | `docker exec <container> nvidia-smi`                                                     | The card                           |

If the variable is there but `nvidia-smi` finds no GPU, `swarm-resource` does not match its name: copy
the name `env` prints.

### Deploy it

Three ways, all naming the stack after the app id:

- **From the Cluster page.** Turn on **Non installées** and click **Installer** on the app's row: it
  then shows in the stack table as **Non déployée**. Its sheet's **Déployer** runs
  `docker stack deploy` and streams its output. Its compose project, if any, is left as it is.
- **From the CLI**, against a manager: `node bin/cli.js swarm miniflux deploy`, or `swarm deploy` for every
  app that has a `compose.swarm.yml`, in category order. See [the CLI](cli.md#swarm-target-verb-args).
- **By hand**, with `docker stack deploy` and the commands above.

Hangar's deploy waits for the services to run (`--detach=false`): it ends once every replica is up, so
pulls on every node make it take a while. From the CLI, `swarm miniflux deploy --detach=true` returns as
soon as the services are updated.

Uninstalling the app (**Désinstaller** in its row's menu, on Apps or Cluster) takes down both its compose
project and its stack.

## A node on WSL

A Windows machine can join the swarm through WSL 2 with `networkingMode=mirrored` in
`%UserProfile%\.wslconfig`: WSL then shares the Windows host's address on the LAN, and the node
advertises it. Three things then need care.

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

### The overlay does not reach the WSL node

The task runs, but a reverse proxy on another node answers **Gateway Timeout**: the overlay carries
nothing back to the WSL node. Its VXLAN packets leave and the peers answer, but the replies stay in
Windows. Mirrored mode forwards an inbound port to Linux only once a Linux process has tried to bind
it, and the VXLAN socket on UDP 4789 is opened by the kernel, which WSL never sees. Every Docker
restart recreates that socket, so the overlay breaks again each time.

Under NAT the overlay never worked either: the node advertised WSL's internal address, which the other
nodes cannot reach. Deploying still worked, because the worker opens every connection to the manager
itself. Making NAT carry the overlay takes a UDP mapping on Windows (`netsh portproxy` is TCP only) that
follows WSL's address, which changes at every start: no simpler than the options below.

WSL has no setting to force the forwarding. `ignoredPorts` does the opposite: it keeps a port's traffic
inside Linux. Two ways around it.

#### Option 1: keep the WSL services off the overlay

A port that Docker publishes is bound by `docker-proxy`, a userspace process, so Windows forwards it.
Publish the service on the node itself, and let the proxy reach it at the node's address rather than
through the overlay:

```yaml
# store/llama-cpp/compose.swarm.yml
services:
  llama-cpp:
    ports:
      - target: 8080
        published: 8080
        protocol: tcp
        mode: host
```

Open the port in the Hyper-V firewall, like the swarm ports above:

```powershell
New-NetFirewallHyperVRule -Name 'Swarm-8080-TCP' -DisplayName 'llama-cpp' -Direction Inbound `
  -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 8080 -Action Allow
```

Traefik's Swarm provider routes to overlay addresses, so declare the route with the file provider
instead, and remove the service's `traefik.*` labels so that the Swarm provider does not add a second
one:

```yaml
# traefik dynamic configuration
http:
  routers:
    llama-cpp:
      rule: Host(`llama.example.lan`)
      service: llama-cpp
  services:
    llama-cpp:
      loadBalancer:
        servers:
          - url: http://<wsl-node-address>:8080
```

No script, and nothing to redo after a restart. The cost: the WSL node's services are not on the
overlay, the proxy has their address written in, and a `mode: host` port allows one replica per node.
Fits a single GPU node.

#### Option 2: register the VXLAN port

A bind attempt from userspace on UDP 4789 is enough for Windows to forward it, even though it fails
while the kernel holds the port. A small service makes that attempt whenever Docker starts or changes
a network, and every minute in case it missed an event. It only tries while the kernel holds the port,
so it never takes the port from Docker. The whole overlay then works, for every service on the node.

The script, `/usr/local/sbin/wsl-vxlan-port`:

```python
#!/usr/bin/python3
"""Make WSL's mirrored networking deliver inbound VXLAN traffic to Linux.

Mirrored mode forwards a port from Windows to Linux once a Linux process tries to
bind it. The VXLAN socket is opened by the kernel, which WSL never sees, so the
overlay replies stay in Windows. A userspace bind attempt on the port registers
it. The attempt is only made while the kernel holds the port, so it always fails
and can never take the port from Docker.

The kernel socket is recreated whenever Docker restarts or an overlay network
comes up on the node: register again on every Docker network event, and every
minute in case an event was missed.
"""

import errno
import select
import socket
import subprocess
import sys
import time

VXLAN_PORT = 4789
PROC_NET_UDP = "/proc/net/udp"
FALLBACK_SECONDS = 60
# Docker creates the VXLAN socket shortly after the network event.
SETTLE_SECONDS = 2


def kernel_holds_vxlan_port():
    port_hex = f"{VXLAN_PORT:04X}"
    with open(PROC_NET_UDP) as table:
        next(table)
        for line in table:
            local_address = line.split()[1]
            if local_address.endswith(f":{port_hex}"):
                return True

    return False


def register_vxlan_port():
    if not kernel_holds_vxlan_port():
        return

    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.bind(("0.0.0.0", VXLAN_PORT))
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
    finally:
        probe.close()


def main():
    register_vxlan_port()
    events = subprocess.Popen(
        ["docker", "events", "--filter", "type=network", "--format", "{{.Action}}"],
        stdout=subprocess.PIPE,
        text=True,
    )
    while True:
        ready, _, _ = select.select([events.stdout], [], [], FALLBACK_SECONDS)
        if ready:
            if not events.stdout.readline():
                sys.exit("docker events stopped")

            time.sleep(SETTLE_SECONDS)

        register_vxlan_port()


main()
```

The unit, `/etc/systemd/system/wsl-vxlan-port.service`, starts and restarts with Docker:

```ini
[Unit]
Description=Register the VXLAN port with WSL mirrored networking
After=docker.service
PartOf=docker.service

[Service]
ExecStart=/usr/local/sbin/wsl-vxlan-port
Restart=always
RestartSec=5

[Install]
WantedBy=docker.service
```

Install it, with `systemd=true` in `/etc/wsl.conf`:

```bash
sudo install -m 755 wsl-vxlan-port /usr/local/sbin/
sudo install -m 644 wsl-vxlan-port.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wsl-vxlan-port.service
```

`systemctl status wsl-vxlan-port` shows it running. After `sudo systemctl restart docker`, the overlay
comes back once the tasks are up, about two seconds after Docker creates the network.

### Diagnose a WSL node

Which node to look from, and what each command tells:

| Where        | Command                                                     | Tells                                                         |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------------- |
| A manager    | `docker service ps --no-trunc <stack>_<service>`            | Each task's node, state and error (a mount that timed out)    |
| The WSL node | `journalctl -u docker -f`                                   | Gossip (`Bulk sync … timed out`), raft and mount errors       |
| The WSL node | `docker ps -a --filter label=com.docker.swarm.service.name` | The tasks that landed there; one stuck in `Created` never ran |
| The WSL node | `systemctl status wsl-vxlan-port`                           | Option 2 of the overlay runs                                  |
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

| What the captures show                                          | Where it breaks                                   |
| --------------------------------------------------------------- | ------------------------------------------------- |
| Packets leave WSL, none reach the peer                          | Windows, on the way out                           |
| The peer receives them with `bad udp cksum`, and does not reply | The checksum: try `sudo ethtool -K eth0 tx off`   |
| The peer replies, nothing comes back on WSL's `eth0`            | The VXLAN port is not registered: see the overlay |

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

A dropped packet logs a drop with its reason. A reply that ends on the `vmswitch.sys` component of
WSL's virtual switch with no drop, yet never shows on `eth0`, is the unregistered VXLAN port.

## Not covered yet

- The image update check and the nightly auto-update cover compose apps only. Update a stack with
  **Mettre à jour**, or `swarm <app> deploy`.
- Services are not managed one by one: no scaling or rollback from the UI. Change `replicas` in
  `compose.swarm.yml` and deploy again.
- Backing up the cluster's keys and the Raft state is planned; see the
  [spec](specs/docker-swarm.md).
