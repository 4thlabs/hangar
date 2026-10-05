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
