import { logger } from "#libs/logs";
import { parse } from "dotenv";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HangarError } from "./hangar-error.ts";

/** Variables compose fills in by itself: they are not the operator's to provide */
const COMPOSE_VARIABLES = ["PWD", "COMPOSE_PROJECT_NAME"];

/** The files compose interpolates: its own fragments and the `env_file:` targets beside them */
const INTERPOLATED = /\.(ya?ml|env)$/;

const HEADER = "# Global Environment Variables\n# These variables are available to all projects\n";

/**
 * The prefixes an app owns: `sync-in` gives `SYNCIN_` and `SYNC_IN_`, because the store writes
 * the name both ways.
 *
 * ponytail: derived from the directory name only, so an app whose variables go by another name
 * — home-assistant publishing `HASS_*` — is missed; let apps declare extra prefixes in `x-hangar`
 * if that stops being the exception.
 */
const prefixes = (app: string) =>
  [app.replaceAll("-", ""), app.replaceAll("-", "_")].map(name => `${name.toUpperCase()}_`);

/** Renders the variables the way the file has always looked: header, timestamp, sorted pairs. */
const serialize = (variables: Record<string, string>) => {
  const body = Object.keys(variables)
    .sort()
    .map(key => `${key}=${variables[key]}`)
    .join("\n");

  return `${HEADER}# Last updated: ${new Date().toISOString()}\n\n${body}\n`;
};

/**
 * The global environment file every stack is composed with, living at the root of the data
 * directory.
 *
 * It is hand-edited as much as it is generated — secrets, mount points, ids — so nothing
 * here ever rewrites it from a caller's idea of its contents: a write merges into whatever
 * is on disk at that instant, and drops only the keys it was explicitly told to drop.
 */
export class HangarEnv {
  /** The env file */
  private readonly _file: string;

  /** The directory holding the installed apps, whose files declare the variables */
  private readonly _installedPath: string;

  /** Values a new variable starts with, when Hangar already knows the answer */
  private readonly _defaults: Record<string, string>;

  /**
   * The file as last parsed, so repeated lookups do not hit the disk. A promise, so concurrent
   * first lookups share one read instead of racing to do the same work.
   */
  private _cached: Promise<Record<string, string>> | undefined;

  /** Returns the path of the env file */
  public file = () => this._file;

  /**
   * Constructs the environment for the installed apps. Does not read anything: neither the file
   * nor the apps exist before the store has been installed.
   * @param dataPath The data directory, holding the env file
   * @param installedPath The directory holding the installed apps, whose files declare the variables
   * @param defaults Values to pre-fill the matching variables with when they first appear
   */
  constructor(dataPath: string, installedPath: string, defaults: Record<string, string> = {}) {
    this._installedPath = installedPath;
    this._file = path.join(dataPath, ".env.global");
    this._defaults = defaults;
  }

  /**
   * The variables currently on disk. A missing file is an empty set, not a failure: on a
   * fresh install it simply has not been created yet.
   */
  async read(): Promise<Record<string, string>> {
    const contents = await readFile(this._file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";

      throw new HangarError(`Cannot read the global env at ${this._file}: ${error.code ?? error.message}`);
    });

    return parse(contents);
  }

  /**
   * One variable's value, or `undefined` when the operator has not provided it. A key seeded by
   * `ensure()` and never filled in sits on disk as an empty string: that is "not set", not a value.
   *
   * Reads the file once and keeps it: every write here drops the cache, so a value changed from
   * the settings page is picked up on the next lookup.
   *
   * An unreadable file answers `undefined` rather than throwing: the callers are widgets and
   * pages asking whether the operator set a token, and a whole dashboard going blank is a worse
   * answer than a card saying the token is missing. It is logged, and not cached, so the next
   * lookup tries the disk again once the file is fixed. Everything else here — `write`, `ensure`,
   * `required` — still fails loudly through `read`.
   *
   * ponytail: only this process's own writes invalidate it, so an edit made directly on disk — or
   * by another Hangar process — is not seen until the next write; watch the file if that stops
   * being the exception.
   * @param key The variable to look up
   */
  async get(key: string) {
    this._cached ??= this.read().catch((error: unknown) => {
      this._cached = undefined;
      logger.warn(`Cannot look up a variable in ${this._file}`, { error, key });

      return {};
    });

    return (await this._cached)[key] || undefined;
  }

  /**
   * One of an app's own variables, looked up under every prefix the app owns. `sync-in` asking
   * for `API_KEY` tries `SYNCIN_API_KEY` then `SYNC_IN_API_KEY`, because `ensure()` seeds
   * whichever spelling the app's own files reference and the store uses both.
   *
   * Callers name the suffix rather than the whole variable: spelling it out at the call site is
   * how the name drifts from what `ensure()` writes.
   * @param app The app the variable belongs to
   * @param suffix The variable's name after the app prefix, e.g. `API_KEY`
   */
  async appVar(app: string, suffix: string) {
    for (const prefix of prefixes(app)) {
      const value = await this.get(`${prefix}${suffix}`);

      if (value) return value;
    }

    return undefined;
  }

  /**
   * Merges `updates` into whatever is on disk *right now* and rewrites the file. Re-reading
   * inside the write is the point: a variable added by hand — or from another tab — between
   * the moment a caller read the file and the moment it saves must survive that save. Only
   * the keys named in `remove` disappear.
   * @param updates The variables to set
   * @param remove The variables to drop, the only way anything is ever lost
   * @returns The variables as they now stand on disk
   */
  async write(updates: Record<string, string>, remove: string[] = []) {
    const next = { ...(await this.read()), ...updates };

    for (const key of remove) delete next[key];

    await this.backup();
    await writeFile(this._file, serialize(next), "utf8");
    this._cached = undefined;

    return next;
  }

  /**
   * The variables the installed apps reference, `${VAR}` and `$VAR` alike. Compose substitutes
   * these at run time, so each one is a value the operator has to provide here. Unfiltered on
   * purpose: this answers what the stacks ask for, not what Hangar seeds.
   */
  async required() {
    return this.referenced(await this.files());
  }

  /**
   * Seeds the variables the installed apps reference, or just the named one's — installing a
   * single app has no reason to re-read every stack. Values start empty unless Hangar already
   * knows the answer, so the operator only sees what is left to fill.
   *
   * Only the namespaced variables are seeded: `APP_*` for Hangar's own shared paths, and
   * `<APP>_*` for any installed app — an app's file may well reference a neighbour's key, as
   * glance does for gluetun. A bare name like `DOMAIN` belongs to no app and is left to the
   * operator. This only ever adds: it never overwrites a filled value and never removes one.
   * @param app The app whose files to read, or every installed app when absent
   */
  async ensure(app?: string) {
    const current = await this.read();
    // Naming the apps is a directory listing; reading their files is what the scope saves.
    const allowed = ["APP_", ...(await this.apps()).flatMap(prefixes)];

    const missing = (await this.referenced(await this.files(app)))
      .filter(key => !(key in current) && allowed.some(prefix => key.startsWith(prefix)))
      .map(key => [key, this._defaults[key] ?? ""] as const);

    return missing.length > 0 ? this.write(Object.fromEntries(missing)) : current;
  }

  /**
   * The names of the installed apps. `app-installed` holds one symlink per app alongside the
   * shared fragments, so an entry that reads as a directory is an app and one that does not —
   * `networks.yml` — is not.
   */
  private async apps() {
    const apps = await Promise.all(
      (await this.entries()).map(async entry =>
        (await readdir(path.join(this._installedPath, entry)).catch(() => null)) === null ? [] : [entry],
      ),
    );

    return apps.flat();
  }

  /**
   * The files compose reads for an app, or for every installed app. Only the app's own directory:
   * `compose.yml` and its fragments sit there, as does every `env_file:` target, while anything
   * under `config/` is the app's runtime configuration — glance's widgets, traefik's routers — which
   * the app expands itself and compose never sees.
   *
   * ponytail: a compose file that `include:`s something from a subdirectory would be missed; walk
   * the includes if one ever does.
   * @param app The app to list, or every installed entry when absent
   */
  private async files(app?: string) {
    const files = await Promise.all(
      (app ? [app] : await this.entries()).map(async entry => {
        const target = path.join(this._installedPath, entry);
        const inner = await readdir(target).catch(() => null);

        // Not a directory: a shared fragment like `networks.yml`, which is itself the file.
        return inner === null ? [target] : inner.map(file => path.join(target, file));
      }),
    );

    return files.flat();
  }

  /**
   * What sits in `app-installed`, minus the env file and its backups. A store that ships no
   * stacks yet lists nothing: that is an empty set, not a failure.
   */
  private async entries() {
    const entries = await readdir(this._installedPath).catch(() => []);

    return entries.filter(entry => !entry.startsWith("."));
  }

  /**
   * The variables the given files reference. Compose interpolates its own fragments and the
   * `env_file:` targets alike, so both are read the same way.
   * @param paths The files to scan, absolute
   */
  private async referenced(paths: string[]) {
    const keys = await Promise.all(
      paths
        .filter(file => INTERPOLATED.test(file))
        .map(async file => {
          const source = await readFile(file, "utf8").catch(() => "");

          // `$$` is compose's escape for a literal dollar: strip those first, or `$$FOO` reads
          // as a reference to FOO.
          return [...source.replaceAll("$$", "").matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
        }),
    );

    return [...new Set(keys.flat())].filter(key => !COMPOSE_VARIABLES.includes(key)).sort();
  }

  /**
   * Copies the file aside before a rewrite, under a timestamped name so every save keeps its
   * own copy. This file holds secrets that exist nowhere else, so a backup that fails for any
   * reason other than "there is nothing to back up yet" stops the write instead of gambling
   * with them.
   *
   * ponytail: backups are never pruned, and the stamp is millisecond-resolution, so two saves
   * inside the same millisecond share one name; add a retention sweep and a counter if either
   * ever bites.
   */
  private async backup() {
    // `:` is fine on Linux but not everywhere, and these names are read by humans.
    const stamp = new Date().toISOString().replaceAll(":", "-");

    await copyFile(this._file, `${this._file}.${stamp}.bak`).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return;

      throw new HangarError(`Cannot back up the global env at ${this._file}: ${error.code ?? error.message}`);
    });
  }
}
