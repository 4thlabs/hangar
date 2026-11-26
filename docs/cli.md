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

The Node CLI is not shipped in the container image. A Rust binary, `hangar`, takes the same `store`
commands. It ships in the image, and each release attaches it as a static binary for the host. See
[the Rust binary](#the-rust-binary). The Node CLI stays until the switch to the Rust server.

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

## The Rust binary

`hangar`, the crate `hangar-cli` of the Cargo workspace, runs the `store` commands above on the Rust
core, with the same invocations: same targets, same order, same `docker compose` calls. The Node CLI
stays until the switch, and is still the one for `swarm`.

It runs [in the container](#in-the-container), [on the host](#on-an-unraid-host) from a release, or
from a checkout:

```bash
cargo build --release -p hangar-cli     # target/release/hangar
cargo run -p hangar-cli -- store up     # or straight from the checkout
```

Like the Node CLI, it reads the `.env` of the working directory as dotenv does (values as they are
written, `$` included, a line it cannot read skipped), the environment taking precedence, and passes
its variables on to `docker` and `git`. It needs only what a command uses: `HANGAR_DATA_DIR`, and
`HANGAR_STORE_URL` for `store install`.

| Command                                            | Runs                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `store install`                                    | the clone or the pull of the store, then its links and `.env.global` |
| `store up [-d] [--pull always] [--force-recreate]` | `up -d` on every listed stack, in order                              |
| `store down`                                       | `down` on every listed stack, in reverse order                       |
| `store pull`                                       | `pull` on every listed stack, all at once                            |
| `store <target> up -d\|down\|restart\|pull`        | the command on a stack or a category, options as above               |
| `store <target> [command] [args...]`               | any other compose command, its arguments passed as they are          |
| `store ls [args...]`                               | `docker compose ls`, with the arguments                              |
| `user hash`                                        | the argon2id hash of a password, for a user of `hangar.yml`          |

A command with an argument the table does not list, as `down --volumes` or `up -d --build`, is
passed through as well, and so is an `up` on a target without `-d`, `--detach`, `--wait` or
`--no-start`, which attaches to its stack as with the Node CLI: it runs on a single stack alone. `store up` adds `-d`.
A target with no command runs `docker compose` alone, which prints its help.

Passed through, a command runs in the order of its name, as with the Node CLI: `up`, `start` and
`restart` in the category order, `down` and `stop` in reverse, stopping at the first failure, any
other on every stack at once, reporting the first failure at the end. Its first word is the
command: an option before it, as `store jellyfin -p traefik down`, is refused, as it would change
the project or the file the target pins.

```bash
cargo run -p hangar-cli -- store jellyfin logs -f
cargo run -p hangar-cli -- store jellyfin exec jellyfin sh
cargo run -p hangar-cli -- store Media stop
```

`user hash`, the Rust server's alone, asks a password twice on the terminal, without echo, and prints its hash for
the `passwordHash` of a user in `hangar.yml` (see [the store](store.md#users)); without a terminal it reads the
first line of stdin, `printf '%s\n' "$PASSWORD" | hangar user hash`. It needs no variable.

Where it differs from the Node CLI:

- It has no `swarm` command yet.
- It says when `docker` or `git` is not installed, where the Node CLI prints the system's error, and,
  once a command whose output it prints failed, when docker has no `compose`, as docker says it
  among that output. A command given the terminal, and `store ls`, leave it to docker.
- Every stack is checked before any runs: a listed stack that is not installed fails the command
  before the others run, where the Node CLI runs those before it.
- On a category, a stack listed in several categories runs at its first place in `hangar.yml`.
- Any command but one passed through on a single stack prints compose's output on stdout, as
  below, where the Node CLI hands it the terminal.
- `up` counts `--wait`, `--no-start` and `--detach=true` as not attaching, the last value of a
  flag winning as with compose, where the Node CLI knows `-d` and `--detach` alone.
- An option before the command's name is refused, where the Node CLI passes it to compose.

A command passed through on a single stack is given the terminal, as `docker compose` run by hand:
its stdin, its TTY, its colours and its Ctrl-C, so that `exec`, `logs -f` and an attached `up` work
as with compose itself, and its exit code is compose's. Any other command prints the output of `docker
compose` as it comes, stdout and stderr together on stdout, the lines of the stacks that run at once
interleaved as the Node CLI shows them. Compose prints its progress as plain lines rather than
redrawing it, its output being piped. `store install` and `store ls` print on the terminal, as git
and compose print there.

Like the Node CLI, `up`, `restart` and `down` stop at the first failure, and `pull` runs on every
stack and reports the first failure at the end. The binary exits with the failed command's own code,
1 when it refused or failed before running one.

Ctrl-C reaches the running `docker compose` or `git`, which most often ends on it, and nothing new
starts: a batch stops at the stack it was on, and the binary exits with 130, or the code of the
child. A child that ignores Ctrl-C is stopped by a second Ctrl-C: SIGTERM, then SIGKILL 10 seconds
later. A third exits at once, with 130, killing what is left.

A command given the terminal keeps its Ctrl-C, as compose run by hand: the binary says nothing,
stops nothing, waits for it to end, and exits with its code, 0 included.

### In the container

The image holds the binary at `/usr/local/bin/hangar`, with what it runs: the docker CLI, compose,
git, the socket and the data directory. The container's environment gives it `HANGAR_DATA_DIR` and
`HANGAR_STORE_URL`, so it needs no `.env`:

```bash
docker exec -it hangar hangar store up
alias hangar='docker exec -it hangar hangar'   # in the host's shell profile
```

`-it` hands compose a terminal, for its TTY and its Ctrl-C: without it, a Ctrl-C stops the
`docker exec` and leaves compose running in the container. A script or a cron job, which has no
terminal, runs it with `docker exec hangar hangar …`.

### On an Unraid host

A `docker exec` adds its start-up time to every command: typed often, the binary runs better on
the host itself. Each release attaches it, static, with its checksum: `hangar-x86_64-unknown-linux-musl`,
and `hangar-aarch64-unknown-linux-musl` for an ARM host. It links no library, whatever the host's
libc: `file` reads the x86_64 one as "static-pie linked", a static binary that keeps its address
randomized, and the aarch64 one as "statically linked", Rust's default for that target. `hangar
--version` prints the release's version. It needs two things on the host; check both:

```bash
docker compose version   # the Compose Manager plugin provides it on Unraid
git --version
```

Unraid's root lives in RAM and is rebuilt at each boot, so the binary is kept on the flash drive
and copied into place by `/boot/config/go`, the script Unraid runs at boot. Download it and check
it:

```bash
mkdir -p /boot/config/hangar && cd /boot/config/hangar
release=https://github.com/4thlabs/hangar/releases/latest/download
curl -fsSLO "$release/hangar-x86_64-unknown-linux-musl"
curl -fsSLO "$release/hangar-x86_64-unknown-linux-musl.sha256"
sha256sum -c hangar-x86_64-unknown-linux-musl.sha256
```

Then add to `/boot/config/go`, and run the line once to have it before the next boot (the flash
drive is FAT32, which keeps no executable bit, hence the copy):

```bash
install -m 755 /boot/config/hangar/hangar-x86_64-unknown-linux-musl /usr/local/bin/hangar
```

The User Scripts plugin does the same with that line in a script set to run at the first array
start. To update, download it again and run the line.

The binary reads the `.env` of the folder it runs from, the environment taking precedence, as
above. The `.env` beside Hangar's `compose.yml` already holds `HANGAR_STORE_URL`; add
`HANGAR_DATA_DIR`, set to the folder the container mounts at the same path, `<that folder>/.data`
with the `compose.yml` of this repository. Run from there, the binary then reads the same
`compose.yml` and `.env.global` as in the container:

```bash
cd /mnt/user/appdata/hangar   # the folder of Hangar's compose.yml and .env
echo 'HANGAR_DATA_DIR="/mnt/user/appdata/hangar/.data"' >> .env
hangar store up
```

The `compose.yml` sets `HANGAR_DATA_DIR` for the container itself, so the line changes nothing
there. To run it from any folder, export both variables in root's shell profile, which `go` has to
write again at each boot as well.
