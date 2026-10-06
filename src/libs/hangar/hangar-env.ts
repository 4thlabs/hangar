import { logger } from "#libs/logs";
import { parse } from "dotenv";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HangarError } from "./hangar-error.ts";

/** What a scan of `app-installed` expects: a dangling app symlink, or a shared fragment read as a directory. */
const EXPECTED_SCAN_ERRORS = new Set(["ENOENT", "ENOTDIR"]);

/** A `.catch` handler that turns any scan error into `fallback`, logging the unexpected ones. */
function fallbackOnScanError<T>(fallback: T, target: string) {
  return (error: NodeJS.ErrnoException): T => {
    const isExpected = error.code !== undefined && EXPECTED_SCAN_ERRORS.has(error.code);

    if (!isExpected) {
      logger.warn("Skipping an unreadable path in the installed apps", { error, path: target });
    }

    return fallback;
  };
}

/**
 * The global environment file every stack is composed with. Hand-edited as much as generated, so a
 * write merges into what is on disk and drops only the keys it is told to.
 */
export class HangarEnv {
  /** Variables compose fills in by itself: they are not the operator's to provide */
  private static readonly ComposeVariables = ["PWD", "COMPOSE_PROJECT_NAME"];

  /** The files compose interpolates: its own fragments and the `env_file:` targets beside them */
  private static readonly Interpolated = /\.(ya?ml|env)$/;

  private static readonly Header = "# Global Environment Variables\n# These variables are available to all projects\n";

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

  public file = () => this._file;

  /**
   * Reads nothing: neither the file nor the apps exist before the store is installed.
   * @param dataPath The data directory, holding the env file
   * @param installedPath The directory holding the installed apps, whose files declare the variables
   * @param defaults Values to pre-fill the matching variables with when they first appear
   */
  constructor(dataPath: string, installedPath: string, defaults: Record<string, string> = {}) {
    this._installedPath = installedPath;
    this._file = path.join(dataPath, ".env.global");
    this._defaults = defaults;
  }

  /** The variables currently on disk; a missing file (fresh install) is an empty set. */
  async read(): Promise<Record<string, string>> {
    const contents = await readFile(this._file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return "";
      }

      throw new HangarError(`Cannot read the global env at ${this._file}: ${error.code ?? error.message}`);
    });

    return parse(contents);
  }

  /**
   * One variable, or `undefined` when unset or empty. Cached until the next write. An unreadable file
   * answers `undefined` (logged, not cached), so a widget shows a missing token, not a blank dashboard.
   * ponytail: an edit made on disk is only seen after this process's next write.
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
   * One of an app's variables, tried under every prefix it owns: `sync-in` + `API_KEY` tries
   * `SYNCIN_API_KEY` then `SYNC_IN_API_KEY`.
   * @param app The app the variable belongs to
   * @param suffix The variable's name after the app prefix, e.g. `API_KEY`
   */
  async appVar(app: string, suffix: string) {
    for (const prefix of HangarEnv.prefixes(app)) {
      const value = await this.get(`${prefix}${suffix}`);

      if (value) {
        return value;
      }
    }

    return undefined;
  }

  /**
   * Merges `updates` into what is on disk *now*, so a variable added meanwhile survives the save.
   * @param updates The variables to set
   * @param remove The variables to drop, the only way anything is ever lost
   * @returns The variables as they now stand on disk
   */
  async write(updates: Record<string, string>, remove: string[] = []) {
    const next = { ...(await this.read()), ...updates };

    for (const key of remove) {
      delete next[key];
    }

    await this.backup();
    await writeFile(this._file, HangarEnv.serialize(next), "utf8");
    this._cached = undefined;

    return next;
  }

  /** Every variable the installed apps reference (`${VAR}` and `$VAR`), seeded or not. */
  async required() {
    return this.referenced(await this.files());
  }

  /**
   * Seeds the namespaced variables (`APP_*`, `<APP>_*`) the apps reference, empty unless a default
   * is known. Only ever adds; a bare name like `DOMAIN` is left to the operator.
   * @param app The app whose files to read, or every installed app when absent
   */
  async ensure(app?: string) {
    const current = await this.read();
    // Naming the apps is a directory listing; reading their files is what the scope saves.
    const allowed = ["APP_", ...(await this.apps()).flatMap(name => HangarEnv.prefixes(name))];

    const missing = (await this.referenced(await this.files(app)))
      .filter(key => !(key in current) && allowed.some(prefix => key.startsWith(prefix)))
      .map(key => [key, this._defaults[key] ?? ""] as const);

    return missing.length > 0 ? this.write(Object.fromEntries(missing)) : current;
  }

  /** The installed apps: the entries of `app-installed` that read as a directory. */
  private async apps() {
    const apps = await Promise.all(
      (await this.entries()).map(async entry => {
        const target = path.join(this._installedPath, entry);
        const inner = await readdir(target).catch(fallbackOnScanError(null, target));

        return inner === null ? [] : [entry];
      }),
    );

    return apps.flat();
  }

  /**
   * The files compose reads for an app, or every app: its own directory, not `config/`, which the
   * app reads itself. ponytail: an `include:` from a subdirectory would be missed.
   * @param app The app to list, or every installed entry when absent
   */
  private async files(app?: string) {
    const files = await Promise.all(
      (app ? [app] : await this.entries()).map(async entry => {
        const target = path.join(this._installedPath, entry);
        const inner = await readdir(target).catch(fallbackOnScanError(null, target));

        // Not a directory: a shared fragment like `networks.yml`, which is itself the file.
        return inner === null ? [target] : inner.map(file => path.join(target, file));
      }),
    );

    return files.flat();
  }

  /** What sits in `app-installed`, minus the dotfiles; empty when the store ships no stacks yet. */
  private async entries() {
    const entries = await readdir(this._installedPath).catch(fallbackOnScanError([], this._installedPath));

    return entries.filter(entry => !entry.startsWith("."));
  }

  /**
   * The variables the given compose fragments and `env_file:` targets reference.
   * @param paths The files to scan, absolute
   */
  private async referenced(paths: string[]) {
    const keys = await Promise.all(
      paths
        .filter(file => HangarEnv.Interpolated.test(file))
        .map(async file => {
          const source = await readFile(file, "utf8").catch(fallbackOnScanError("", file));

          // `$$` is compose's escape for a literal dollar: strip those first, or `$$FOO` reads
          // as a reference to FOO.
          return [...source.replaceAll("$$", "").matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
        }),
    );

    return [...new Set(keys.flat())].filter(key => !HangarEnv.ComposeVariables.includes(key)).sort();
  }

  /**
   * Copies the file aside under a timestamped name. It holds secrets kept nowhere else, so a failed
   * backup stops the write. ponytail: never pruned; two saves in one millisecond share a name.
   */
  private async backup() {
    // `:` is fine on Linux but not everywhere, and these names are read by humans.
    const stamp = new Date().toISOString().replaceAll(":", "-");

    await copyFile(this._file, `${this._file}.${stamp}.bak`).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return;
      }

      throw new HangarError(`Cannot back up the global env at ${this._file}: ${error.code ?? error.message}`);
    });
  }

  /**
   * The prefixes an app owns: `sync-in` gives `SYNCIN_` and `SYNC_IN_`, as the store uses both.
   * ponytail: from the directory name only, so `HASS_*` for home-assistant is missed.
   */
  private static prefixes(app: string) {
    return [app.replaceAll("-", ""), app.replaceAll("-", "_")].map(name => `${name.toUpperCase()}_`);
  }

  /** Renders the variables the way the file has always looked: header, timestamp, sorted pairs. */
  private static serialize(variables: Record<string, string>) {
    const body = Object.keys(variables)
      .sort()
      .map(key => `${key}=${variables[key]}`)
      .join("\n");

    return `${HangarEnv.Header}# Last updated: ${new Date().toISOString()}\n\n${body}\n`;
  }
}
