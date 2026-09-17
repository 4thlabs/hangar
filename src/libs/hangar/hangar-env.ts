import { parse } from "dotenv";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HangarError } from "./hangar-error.ts";

/** Variables compose fills in by itself: they are not the operator's to provide */
const COMPOSE_VARIABLES = ["PWD", "COMPOSE_PROJECT_NAME"];

const HEADER = "# Global Environment Variables\n# These variables are available to all projects\n";

/** Renders the variables the way the file has always looked: header, timestamp, sorted pairs. */
const serialize = (variables: Record<string, string>) => {
  const body = Object.keys(variables)
    .sort()
    .map(key => `${key}=${variables[key]}`)
    .join("\n");

  return `${HEADER}# Last updated: ${new Date().toISOString()}\n\n${body}\n`;
};

/**
 * The global environment file every stack is composed with, living next to the installed
 * apps.
 *
 * It is hand-edited as much as it is generated — secrets, mount points, ids — so nothing
 * here ever rewrites it from a caller's idea of its contents: a write merges into whatever
 * is on disk at that instant, and drops only the keys it was explicitly told to drop.
 */
export class HangarEnv {
  /** The env file */
  private readonly _file: string;

  /** The directory holding the stacks whose compose files declare the variables */
  private readonly _stacksPath: string;

  /** Values a new variable starts with, when Hangar already knows the answer */
  private readonly _defaults: Record<string, string>;

  /** Returns the path of the env file */
  public file = () => this._file;

  /**
   * Constructs the environment for the given file. Does not read it: neither the file nor
   * the stacks exist before the store has been installed.
   * @param file The path to the global env file
   * @param stacksPath The directory holding the store's stacks
   * @param defaults Values to pre-fill the matching variables with when they first appear
   */
  constructor(file: string, stacksPath: string, defaults: Record<string, string> = {}) {
    this._file = file;
    this._stacksPath = stacksPath;
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

    return next;
  }

  /**
   * The variables the stacks' compose files reference, `${VAR}` and `$VAR` alike. Compose
   * substitutes these at run time, so each one is a value the operator has to provide here.
   */
  async required() {
    // A store that ships no stacks yet asks for no variables: that is an empty list, not a failure.
    const entries = await readdir(this._stacksPath, { recursive: true }).catch(() => []);
    const files = entries.filter(entry => entry.endsWith(".yml"));

    const keys = await Promise.all(
      files.map(async file => {
        const source = await readFile(path.join(this._stacksPath, file), "utf8").catch(() => "");

        // `$$` is compose's escape for a literal dollar: strip those first, or `$$FOO` reads
        // as a reference to FOO.
        return [...source.replaceAll("$$", "").matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
      }),
    );

    return [...new Set(keys.flat())].filter(key => !COMPOSE_VARIABLES.includes(key)).sort();
  }

  /**
   * Adds every variable the stacks reference when it is absent, empty unless Hangar already
   * knows the value, so the operator only sees what is left to fill. Never overwrites a
   * filled value, never removes one.
   */
  async ensure() {
    const current = await this.read();
    const missing = (await this.required())
      .filter(key => !(key in current))
      .map(key => [key, this._defaults[key] ?? ""] as const);

    return missing.length > 0 ? this.write(Object.fromEntries(missing)) : current;
  }

  /**
   * Copies the file aside before a rewrite, under a timestamped name so every save keeps its
   * own copy. This file holds secrets that exist nowhere else, so a backup that fails for any
   * reason other than "there is nothing to back up yet" stops the write instead of gambling
   * with them.
   *
   * ponytail: backups are never pruned; add a retention sweep if the directory grows.
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
