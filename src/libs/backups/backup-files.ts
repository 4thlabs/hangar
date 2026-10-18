import type { Dirent, Stats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";

/** A regular file a backup archives. */
export type BackupFile = {
  absolute: string;
  /** Relative to the backed-up folder, with `/` separators: what the globs match and the archive names */
  relative: string;
  stats: Stats;
};

/**
 * The files of a folder that a backup archives: the regular files `include` matches and `exclude`
 * does not. Neither glob skips a dotfile, as an app's data is full of them (`.config`, `.local`).
 *
 * A symbolic link is never followed: it could loop, or lead out of the app's data. The walk counts
 * the ones it leaves out, so the report can say the archive misses them.
 */
export class BackupFiles {
  private static readonly MatchOptions = { dot: true };

  private readonly root: string;

  private readonly isIncluded: (relative: string) => boolean;

  private readonly isExcluded: (relative: string) => boolean;

  private _skippedLinks = 0;

  /**
   * @param root The folder to walk
   * @param include Globs of the files to keep, relative to `root`
   * @param exclude Globs of the files and folders to leave out; an excluded folder is not walked into
   */
  constructor(root: string, include: string[], exclude: string[]) {
    this.root = root;
    this.isIncluded = picomatch(include, BackupFiles.MatchOptions);
    this.isExcluded = exclude.length > 0 ? picomatch(exclude, BackupFiles.MatchOptions) : () => false;
  }

  /** How many symbolic links the walk has left out so far. */
  skippedLinks() {
    return this._skippedLinks;
  }

  /** The files to archive, folder by folder in name order. */
  entries(): AsyncGenerator<BackupFile> {
    return this.walk("");
  }

  private async *walk(relativeFolder: string): AsyncGenerator<BackupFile> {
    const entries = await BackupFiles.unlessGone(
      readdir(path.join(this.root, relativeFolder), { withFileTypes: true }),
      [] as Dirent[],
    );

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relative = relativeFolder === "" ? entry.name : `${relativeFolder}/${entry.name}`;

      if (this.isExcluded(relative)) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        this._skippedLinks++;
        continue;
      }

      if (entry.isDirectory()) {
        yield* this.walk(relative);
        continue;
      }

      // Sockets, pipes and devices have nothing to read.
      if (!entry.isFile() || !this.isIncluded(relative)) {
        continue;
      }

      const absolute = path.join(this.root, relative);
      const stats = await BackupFiles.unlessGone(lstat(absolute), undefined);

      if (stats) {
        yield { absolute, relative, stats };
      }
    }
  }

  /**
   * `operation`'s result, or `fallback` when the path it reads no longer exists: a live app removes
   * files at any time (a journal, a temp file), and one gone is no failure of the backup.
   */
  static async unlessGone<T, F>(operation: Promise<T>, fallback: F): Promise<T | F> {
    try {
      return await operation;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return fallback;
      }

      throw error;
    }
  }
}
