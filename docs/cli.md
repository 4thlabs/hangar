# CLI

Everything the Apps page does to a stack is `docker compose` underneath, and the CLI gives you the
same commands from a terminal: same store, same `.env.global`, same start order.

It runs from a checkout of this repository, with Node 24, against the variables of a `.env` at its
root (see [`.env.example`](../.env.example)):

```bash
git clone https://github.com/4thlabs/hangar.git && cd hangar
npm ci
cp .env.example .env   # point HANGAR_DATA_DIR and HANGAR_STORE_URL at your setup
node bin/cli.js --help
```

The CLI is not shipped in the container image.

## Commands

### `store install`

Clones the store into `<data>/app-store`, or pulls it with `--ff-only` when it is already there.
Then adds the variables the apps `hangar.yml` declares reference, and those of the fragments next to
them, to `.env.global`. Nothing else is written: any app of the store can be run by name.

```bash
node bin/cli.js store install
```

### `store up [args...]`

Brings every listed stack up, detached, in the order `hangar.yml` lists them, except the
`run: false` ones. Extra arguments are passed to `docker compose up`.

```bash
node bin/cli.js store up --pull always
```

### `store down [args...]`

Takes every listed stack down, in reverse order, `run: false` included: an app started by hand
does not survive a `store down` before host maintenance.

### `store ls [args...]`

Runs `docker compose ls`: the Compose projects running on the host.

### `store <target> [compose args...]`

Runs any `docker compose` command against a target, which is one of:

- **a stack**, by its app id: `jellyfin`;
- **a category** from `hangar.yml`, covering its stacks, `run: false` included: `Media`;
- **`pull`**, covering the same stacks as `store up`.

```bash
node bin/cli.js store jellyfin logs -f
node bin/cli.js store Media restart
node bin/cli.js store pull
```

On several stacks, `up` and `start` follow the category order, `down` and `stop` reverse it and
stop at the first failure; every other command runs on all stacks in parallel and reports the
first failure at the end. A non-detached `up` is only allowed on a single stack. A name that is
neither a category nor an app of the store fails with `Unknown app or category`.

Each call is `docker compose --env-file <data>/.env.global -p <stack> -f <compose.yml> …`, so the
project is always named after the stack, as the web app expects.

### `swarm <target> <verb> [args...]`

The Swarm counterpart of `store`, for the apps that ship a `compose.swarm.yml` (see
[the store](store.md#an-apps-composeswarmyml)). Run it against a manager. The verbs:

| Verb            | Runs                                                                                    |
| --------------- | --------------------------------------------------------------------------------------- |
| `deploy [args]` | `docker stack deploy -c <app>/compose.yml -c <app>/compose.swarm.yml …args <app>`       |
| `config`        | `docker stack config -c <app>/compose.yml -c <app>/compose.swarm.yml`, nothing deployed |
| `rm`            | `docker stack rm <app>`                                                                 |
| `ps [args]`     | `docker stack ps …args <app>`                                                           |
| `services`      | `docker stack services <app>`                                                           |

The target is one of:

- **an app**, by its id: any app of the store with a `compose.swarm.yml`, listed in `hangar.yml` or
  not: the file only drives the commands over lists;
- **`deploy`** or **`rm`** alone, covering the [`swarm:` list](store.md#swarm) of `hangar.yml`, in its
  order for `deploy` and backwards for `rm`. A listed app without a `compose.swarm.yml` is skipped
  with a warning.

Categories group the compose apps: `swarm Media deploy` is refused.

```bash
node bin/cli.js swarm deploy            # the swarm: list, in its order
node bin/cli.js swarm miniflux deploy   # one app; extra args go to docker stack deploy
node bin/cli.js swarm rm                # the swarm: list, backwards
node bin/cli.js swarm miniflux ps
```

`swarm` and `store` are independent: an app can run with compose and in the swarm at the same time,
and neither command touches the other. Mind the volumes both copies would share.

The stack is always named after the app. `docker stack` has no `--env-file`: the CLI hands it
`.env.global` as its environment. To do the same by hand:

```bash
set -a; . <data>/.env.global; set +a
docker stack deploy -c compose.yml -c compose.swarm.yml miniflux
```

### `swarm ls [args...]`

Runs `docker stack ls`: the stacks running in the swarm, deployed by Hangar or not.
