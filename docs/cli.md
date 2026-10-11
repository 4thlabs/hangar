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
Then links every app `hangar.yml` lists, plus the shared files, and adds the variables they
reference to `.env.global`.

```bash
node bin/cli.js store install
```

### `store up [args...]`

Brings every listed stack up, detached, in the order `hangar.yml` lists them. Extra arguments are
passed to `docker compose up`.

```bash
node bin/cli.js store up --pull always
```

### `store down [args...]`

Takes every listed stack down, in reverse order.

### `store ls [args...]`

Runs `docker compose ls`: the Compose projects running on the host.

### `store <target> [compose args...]`

Runs any `docker compose` command against a target, which is one of:

- **a stack**, by its app id: `jellyfin`;
- **a category** from `hangar.yml`, covering its stacks: `Media`;
- **`pull`**, covering every listed stack (as do `up` and `down` above).

```bash
node bin/cli.js store jellyfin logs -f
node bin/cli.js store Media restart
node bin/cli.js store pull
```

On several stacks, `up` and `start` follow the category order, `down` and `stop` reverse it and
stop at the first failure; every other command runs on all stacks in parallel and reports the
first failure at the end. A non-detached `up` is only allowed on a single stack.

Each call is `docker compose --env-file <data>/.env.global -p <stack> -f <compose.yml> …`, so the
project is always named after the stack, as the web app expects.

### `swarm <target> <verb> [args...]`

The Swarm counterpart of `store`, for the apps that ship a `compose.swarm.yml` (see
[the store](store.md#an-apps-composeswarmyml)). Run it against a manager. The verbs:

| Verb                    | Runs                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `deploy [args]`         | `docker stack deploy -c <app>/compose.yml -c <app>/compose.swarm.yml --detach=false …args <app>` |
| `config`                | `docker stack config -c <app>/compose.yml -c <app>/compose.swarm.yml`, nothing deployed          |
| `rm`                    | `docker stack rm <app>`                                                                          |
| `ps [args]`             | `docker stack ps …args <app>`                                                                    |
| `services`              | `docker stack services <app>`                                                                    |
| `logs <service> [args]` | `docker service logs …args <app>_<service>`: `docker stack` has no logs                          |

The target is one of:

- **an app**, by its id: any installed app with a `compose.swarm.yml`;
- **a category**, covering its apps that have one;
- **`deploy`** or **`rm`** alone, covering the apps of every category that have one, as `store up`
  covers the apps of every category.

```bash
node bin/cli.js swarm deploy            # every app with a compose.swarm.yml, in category order
node bin/cli.js swarm miniflux deploy   # one app; extra args go to docker stack deploy
node bin/cli.js swarm Media rm          # a category, in reverse order
node bin/cli.js swarm miniflux ps
node bin/cli.js swarm miniflux logs db -f --tail 50   # the miniflux_db service, every task
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
