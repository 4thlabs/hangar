import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "dotenv";
import { logger } from "#libs/logs";
import { HangarError } from "./hangar-error.ts";
import { Runtime } from "./runtime/runtime.ts";

/** What a scan of the store expects: an app that is gone, or a shared fragment read as a directory. */
const EXPECTED_SCAN_ERRORS = new Set(["ENOENT", "ENOTDIR"]);

/** A `.catch` handler that turns any scan error into `fallback`, logging the unexpected ones. */
function fallbackOnScanError<T>(fallback: T, target: string) {
  return (error: NodeJS.ErrnoException): T => {
    const isExpected = error.code !== undefined && EXPECTED_SCAN_ERRORS.has(error.code);

    if (!isExpected) {
      logger.warn("Skipping an unreadable path in the store", { error, path: target });
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

  /** What compose accepts as a variable name */
  private static readonly VariableName = /[A-Za-z_][A-Za-z0-9_]*/;

  /** A whole string that is a variable name */
  private static readonly WholeVariableName = new RegExp(`^${HangarEnv.VariableName.source}$`);

  /** A reference to a variable in a compose file, `$FOO` or `${FOO…}`, capturing its name */
  private static readonly Reference = new RegExp(String.raw`\$\{?(${HangarEnv.VariableName.source})`);

  private static readonly Header = "# Global Environment Variables\n# These variables are available to all projects\n";

  private readonly _file: string;

  /** The store's app folders, and the fragments they share at its root */
  private readonly _appsPath: string;

  /** The apps a full scan covers, whose prefixes it may seed */
  private readonly _scope: () => Promise<string[]>;

  /** Values a new variable starts with, when Hangar already knows the answer */
  private readonly _defaults: Record<string, string>;

  /**
   * The file as last parsed, so repeated lookups do not hit the disk. A promise, so concurrent
   * first lookups share one read instead of racing to do the same work.
   */
  private _cached: Promise<Record<string, string>> | undefined;

  public file = () => this._file;

  /**
   * Reads nothing: neither the file nor the apps exist before the store is cloned.
   * @param dataPath The data directory, holding the env file
   * @param appsPath The store's `store/` folder: one folder per app, shared fragments at its root
   * @param scope The apps a full scan covers; read on every scan, so it follows the store
   * @param defaults Values to pre-fill the matching variables with when they first appear
   */
  constructor(
    dataPath: string,
    appsPath: string,
    scope: () => Promise<string[]>,
    defaults: Record<string, string> = {},
  ) {
    this._appsPath = appsPath;
    this._scope = scope;
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

  /** Every variable the apps in scope and the shared fragments reference (`${VAR}` and `$VAR`), seeded or not. */
  async required() {
    return this.referenced(await this.files());
  }

  /**
   * Seeds the namespaced variables (`APP_*`, `<APP>_*`) the apps reference, empty unless a default
   * is known. Only ever adds; a bare name like `DOMAIN` is left to the operator.
   * @param app The app whose files to read, or every app in scope when absent
   */
  async ensure(app?: string) {
    return this.seed(await this.seedable(app));
  }

  /**
   * Seeds an app's variables, then names those still empty: what it would start with blank, a database
   * password included. A bare name like `DOMAIN` is the operator's and left out, as {@link ensure} does.
   * @param app The app about to start
   */
  async unfilled(app: string) {
    const keys = await this.seedable(app);
    const current = await this.seed(keys);

    return keys.filter(key => !current[key]);
  }

  /** Adds the keys the file lacks, empty unless a default is known; returns the variables as they now stand. */
  private async seed(keys: string[]) {
    const current = await this.read();

    const missing = keys.filter(key => !(key in current)).map(key => [key, this._defaults[key] ?? ""] as const);

    // Every compose call passes `--env-file`: with no file at all it fails, so one is written even when
    // no app references a variable yet.
    const mustWrite = missing.length > 0 || !(await Runtime.exists(this._file));

    return mustWrite ? this.write(Object.fromEntries(missing)) : current;
  }

  /** The namespaced variables (`APP_*`, `<APP>_*`) the app, or every app in scope, references. */
  private async seedable(app?: string) {
    const allowed = ["APP_", ...(await this.owners()).flatMap(name => HangarEnv.prefixes(name))];

    return (await this.referenced(await this.files(app))).filter(key => allowed.some(prefix => key.startsWith(prefix)));
  }

  /**
   * The folders of the store, each owning its `<APP>_*` prefix whether it is in scope or not: a shared
   * fragment, or an app's own env file, may reach for a neighbour's key.
   */
  private async owners() {
    return (await this.storeEntries()).filter(entry => entry.isDirectory()).map(entry => entry.name);
  }

  /**
   * The files compose reads for an app, or for every app in scope plus the fragments at the root of
   * the store (`networks.yml`): the app's own directory, not `config/`, which the app reads itself.
   * ponytail: an `include:` from a subdirectory would be missed.
   * @param app The app to list, or every app in scope when absent
   */
  private async files(app?: string) {
    if (app) {
      return this.appFiles(app);
    }

    // An app in scope whose folder is gone lists no file, and so asks for nothing.
    const apps = await Promise.all((await this._scope()).map(scoped => this.appFiles(scoped)));

    return [...apps.flat(), ...(await this.sharedFiles())];
  }

  /** The files directly in an app's folder; none when it has no folder. */
  private async appFiles(app: string) {
    const folder = path.join(this._appsPath, app);
    const inner = await readdir(folder).catch(fallbackOnScanError([], folder));

    return inner.map(file => path.join(folder, file));
  }

  /** The files at the root of the store, next to the app folders, minus the dotfiles. */
  private async sharedFiles() {
    return (await this.storeEntries())
      .filter(entry => entry.isFile() && !entry.name.startsWith("."))
      .map(entry => path.join(this._appsPath, entry.name));
  }

  /** What sits directly in `store/`: the app folders and the shared fragments; nothing before the clone. */
  private storeEntries() {
    return readdir(this._appsPath, { withFileTypes: true }).catch(fallbackOnScanError([], this._appsPath));
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
          return [...source.replaceAll("$$", "").matchAll(new RegExp(HangarEnv.Reference, "g"))].map(
            match => match[1]!,
          );
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

  /** Whether `name` is a variable name compose accepts. */
  static isVariableName(name: string) {
    return HangarEnv.WholeVariableName.test(name);
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
