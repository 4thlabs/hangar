# Spec: store configuration without installed apps

- **Status:** Implemented (steps 1 to 3)
- **Date:** 2026-10-11
- **Owner:** Thomas

## Goal

Say in `hangar.yml` which compose apps the CLI starts in bulk and in which order, whether the nightly job
updates them, and which apps run in the swarm; drop the link phase that keeps an "installed" state on disk.

Compose and Swarm stay two independent ways to run an app, in the CLI and on the site alike: where an app
runs is the operator's choice of command or button, never something `hangar.yml` decides.

Categories stay in `hangar.yml` and stay a display concern: the compose file keeps only `x-hangar.name` and
`x-hangar.icon`.

Out of scope: auto-updating swarm stacks (the nightly job covers compose apps only, as today), and start
orders independent of the display order.

## Why the link phase goes

`store install` symlinks every app `hangar.yml` lists into `<data>/app-installed/`, and the store page's
Install button does the same for one app. That symlink is the only "installed" state Hangar keeps. It isolates
nothing (it points into the clone, so a pull changes the running definition at once) and costs:

- `shared:`, whose files are linked next to the apps only so `../networks.yml` resolves from
  `app-installed/<app>/`. From `app-store/store/<app>/` it resolves by itself.
- A required order on uninstall: `down` before `unlink`, or the project is orphaned (`store-apps.ts:67`).
- Dangling-link handling in the environment scan (`hangar-env.ts:7`).
- An asymmetry with `hangar.yml`: listing an app links it, removing it does not unlink it, and an app
  uninstalled from the UI but still listed makes `store up` fail with "Failed to find project".

What "installed" is really used for is keeping an app that is down on the Apps page. Being declared in
`hangar.yml` does that job.

## `hangar.yml`

```yaml
categories:
  - name: Infrastructure
    color: "#64748b"
    stacks:
      - traefik
      - { id: arcane, update: false }
  - name: Home
    color: "#22c55e"
    stacks:
      - frigate
      - miniflux
  - name: Lab
    color: "#f59e0b"
    stacks:
      - { id: llama-cpp, run: false, update: false }

swarm: [miniflux, whoami]

widgets: …
registryThrottling: 100
```

`categories` describe the compose apps: how the Apps page shows them, and the order `store up` and
`store down` go through them. `swarm` lists the apps `swarm deploy` runs in the swarm, in its own order.

A `stacks` entry is an app id, or an object when the app needs an option. The bare id is short for
`{ id }` with every default, as Compose's own short and long syntaxes.

| Field    | Default | Meaning                                      |
| -------- | ------- | -------------------------------------------- |
| `id`     | —       | The app: its folder under `store/`           |
| `run`    | `true`  | Whether `store up` starts it with the others |
| `update` | `true`  | Whether the nightly job updates it           |

- **Order:** categories in file order, then `stacks` in list order, is the start order, as today.
- **Display:** the category gives the Apps page its filter and colour. An app may be declared in no category:
  it is then shown ungrouped, never started in bulk, and auto-updated by default.
- **Swarm, kept simple for now:** `swarm:` is a plain list of app ids, each with a `compose.swarm.yml`.
  It is independent of the categories: an app may be in both and run both ways. No options yet; the nightly
  job does not update swarm stacks.
- **`shared:` is gone.** An app is a folder of `store/` holding a `compose.yml`; any other entry
  (`networks.yml`) is left out without being listed. An old file still loads: the key is ignored with a
  warning.

### Validation

The schema stays structural, so a file that loads today keeps loading. It normalizes each entry to the object
form, so no consumer sees the union. Entries are strict objects: a misspelled `autoupdate` is an error, not a
silently dropped key.

The checks that need the store run in `HangarStore`, rejecting on save (Paramètres → Configuration) and only
warning on load, so a bad file never stops the server from booting:

| Check                                                                      | On load                     |
| -------------------------------------------------------------------------- | --------------------------- |
| An app declared twice                                                      | First entry wins, as today  |
| An id with no folder in `store/`                                           | Entry ignored               |
| A category named like a store app, or like a CLI word (`install`, `up`, …) | The category wins, as today |
| An app listed twice under `swarm`                                          | Deployed once               |
| A `swarm` app without a non-empty `compose.swarm.yml`                      | Skipped, with a warning     |

The CLI words are those of the `store` command: `install`, `up`, `down`, `ls` and `pull`. A category named
after one could never be addressed. `swarm` takes no category, so its `deploy` and `rm` are free.

## CLI

A target is resolved once into a typed value instead of falling back to "anything else is a stack name"
(`HangarStore.resolve`, `hangar-store.ts:91`):

- **all**: no target, or a global command (`up`, `down`, `pull`; `deploy`, `rm` for `swarm`);
- **a category**: a name `hangar.yml` declares;
- **an app**: any other name, which must be a store app, else "Unknown app or category: <name>".

A category that ends up empty for a command does nothing and says so, rather than being taken for an app id.

| Command                   | Covers                                                                      |
| ------------------------- | --------------------------------------------------------------------------- |
| `store up`, `store pull`  | Every listed app but the `run: false` ones, in order                        |
| `store down`              | Every listed app, `run: false` included, in reverse                         |
| `store <category> <args>` | The category's apps, `run: false` included                                  |
| `store <app> <args>`      | Any store app                                                               |
| `swarm deploy`            | The `swarm:` list, in its order                                             |
| `swarm rm`                | The `swarm:` list, in reverse                                               |
| `swarm <category> <verb>` | Refused: categories group the compose apps                                  |
| `swarm <app> <verb>`      | Any store app with a `compose.swarm.yml`                                    |
| `store install`           | Clone or pull, then seed `.env.global` for the declared apps; links nothing |

- `store down` covers the `run: false` apps too: before host maintenance, an app started by hand must
  not survive it.
- A compose group skips, with a warning, an id with no app behind it or one compose rejects as a project
  name (`llama.cpp`): such an app can still run in the swarm.
- Unchanged: the run order per command (`CommandOrder`, `StackCommandOrder`), parallel runs for the other
  commands, and the refusal of a non-detached `up` on several apps.
- Every call now points at the clone: `docker compose -p <app> -f <data>/app-store/store/<app>/compose.yml`,
  and the same folder for `docker stack`.

The CLI stays plain Node: the logic lives in `HangarStore` and `HangarConfig`, and the commands in
`src/cli` gain no import.

## The web app

The site keeps compose and swarm as independent as the CLI does: one button or page per way of running an
app, and neither touches the other.

### Apps page

The compose side. The list is computed from two sets, with no stored state:

- **apps in a category**: always a row, with no container (never started, or after a `down`);
- **store apps Docker has a compose project for**: a row while the project exists, declared or not.

An app only in the `swarm:` list gets no permanent row: its place is the Cluster page.

The Docker layer's injected interface changes from `InstalledApps { installedProjectIds() }`
(`docker.ts:67`) to `StoreApps { declaredAppIds(); appIds() }`, satisfied by
`hangar.store`. `refuseAppOperation` (`app-operations.ts:26`) accepts any store app instead of an installed
one.

### Store page

- **Install / Uninstall become "Démarrer"**, the compose button. It seeds the app's variables
  (`env.ensure(app)`), then runs `compose up -d`. While a variable the app references and Hangar seeded
  (`APP_*`, `<APP>_*`) is still empty, it asks for confirmation first, naming them and pointing to
  Paramètres → Environnement: seeding writes empty values, and a database started with an empty password is
  worth a second look. A confirmation rather than a refusal, because some apps accept an empty optional
  variable.
- **"Déployer sur le swarm"** stays the swarm button, beside it and independent of it. It no longer links
  anything before deploying, and asks the same confirmation for empty variables.
- Each side is removed where it runs: the compose project from the Apps page, the stack from the Cluster
  page. Nothing takes both down at once any more.
- The "Installées / Non installées" filter goes, with its counts (`search-codec.ts`, `store-filter-menu.tsx`,
  `listing.ts`): the store lists every app, and the Apps and Cluster pages are where to see what runs.

### Cluster page

The swarm side. `isStackManageable` becomes "a store app with a `compose.swarm.yml`", without the installed
check.

## Nightly update

`UpdateOutdatedApps` (`update-outdated-apps.ts`) gets two filters:

- it skips apps declared with `update: false`; the update badge and the manual update stay;
- it only updates projects with a running container. Today `runningImages` includes exited containers
  (`all: true`, `docker.ts:229`), and the job's `up -d --pull always` starts a stopped app.

## `.env.global`

`HangarEnv` scans the store instead of `app-installed/`:

- `ensure()` with no app: the declared apps, plus the fragments at the root of `store/` (`networks.yml`).
- `ensure(app)`: that app's folder, as today.
- The `<APP>_*` prefixes it may seed are derived from every store app's folder name.

## Migration

`app-installed/` only ever holds symlinks, never data. Only paths change:

- **`hangar.yml`:** a current file stays valid; remove `shared:` to silence the warning.
- **Containers:** the compose project's working directory moves from `app-installed/<app>` to
  `app-store/store/<app>`. A relative bind mount (`./config`) is the same folder under another path, so the
  next `up` recreates those containers once.
- **`app-installed/`:** delete it by hand only once every app has been brought up with the new version.
  A container created before still mounts its own files through it; removed too early, Docker mounts an
  empty folder in their place at the next restart. Hangar does not remove it.
- **App ids:** compose rejects `llama.cpp` as a project name. Rename such a folder (`llama-cpp`) to run it
  with compose.

## Code layout

| Where                                              | What                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/libs/hangar/hangar-config.ts`                 | Stack entry schema (id or object, normalized), `shared` deprecated                    |
| `src/libs/hangar/config-check.ts`                  | `ConfigCheck`: the checks against the store, refused on save, logged on load          |
| `src/libs/hangar/hangar-store.ts`                  | Typed targets, filtering by `run`, cross-checks, paths into the clone                 |
| `src/libs/hangar/hangar-env.ts`                    | Scans the store instead of `app-installed/`                                           |
| `src/libs/docker/docker.ts`, `compose.ts`, `mock/` | `StoreApps` instead of `InstalledApps`                                                |
| `src/libs/jobs/jobs/update-outdated-apps.ts`       | `update` and running-only filters                                                     |
| `src/modules/store/`                               | "Démarrer", no installed filter, the swarm button without `installed`                 |
| `src/modules/apps/`                                | `refuseAppOperation`, categories from normalized entries (`snapshots.ts`)             |
| `src/modules/cluster/`                             | `isStackManageable` callers                                                           |
| `docs/`                                            | `cli.md`, `store.md`, `getting-started.md`, `development.md`, `swarm.md`, `README.md` |

`docs/specs/docker-swarm.md` is a dated plan and left as written: its "Nothing in hangar.yml marks an app
for the swarm" is superseded by the `swarm:` list.

## Tests

- `HangarConfig`: bare and object entries normalize to the same shape; defaults; a misspelled key fails; a
  file with `shared:` still loads.
- `HangarStore` with a fake `CommandRunner`: the argv points into the clone; `store up` skips
  `run: false` and `store down` covers it; an app with a `compose.swarm.yml` stays in the compose
  groups; `swarm deploy` follows the `swarm:` list and `rm` reverses it; `swarm <category>` is refused; a
  category with nothing to run does nothing; an unknown name fails with "Unknown app or category".
- `HangarStore` cross-checks: each row of the validation table rejects on save and warns on load.
- `HangarEnv`: seeds from the store, includes root fragments, ignores undeclared apps on a full `ensure()`.
- `UpdateOutdatedApps`: skips `update: false` and stopped projects.
- Docker layer: a declared app with no container has a row, an undeclared one only while its project exists.

## Plan

Three steps, so the refactor ships apart from the behaviour changes.

### Step 1: run from the clone

Branch `refactor/store-paths`. No behaviour change: compose, `docker stack` and the environment scan use
`app-store/store/<app>`; the shared files stop being linked. The symlink stays, only as the install marker.

### Step 2: stack entries

Branch `feat/store-stack-entries`. The entry schema with `run` and `update`, the `swarm:` list,
typed targets,
the cross-checks, the CLI semantics above, and both filters of the nightly job. Docs: `cli.md`, `store.md`.

### Step 3: no installed state

Branch `feat/store-no-install`. Remove `link`, `unlink`, `linkAll`, `installedPath` and
`HangarApp.installed`; the Apps page list from declared apps and Docker; "Démarrer" on the store page;
`StoreApps` in the Docker layer; `isStackManageable` and `refuseAppOperation`; `shared:` deprecated. Docs:
the rest of the table above.
