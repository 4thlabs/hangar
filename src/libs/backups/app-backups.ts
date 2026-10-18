import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { AppId, HangarError, NotFoundError, type BackupConfig } from "#libs/hangar";
import { BackupFiles } from "./backup-files.ts";

/** One archive of an app, as the app page lists it. */
export type BackupArchive = {
  /** The archive's name, its creation time: `2026-10-18T03-30-00-000Z` */
  archive: string;
  size: number;
  /** ISO timestamp */
  createdAt: string;
};

/** What one backup wrote. */
export type BackupSummary = {
  archive: string;
  size: number;
  /** How many files the archive holds */
  files: number;
  /** The symbolic links left out of the archive */
  skippedLinks: number;
};

/** An archive on disk, ready to send. */
export type BackupDownload = {
  path: string;
  size: number;
  /** The file name the browser saves it under */
  downloadName: string;
};

/**
 * The zip archives of each app's data folder, under `app-backups/<app>/`.
 *
 * An archive is named after the time it was started at, with no `:` so the name stays a valid file
 * name everywhere; in name order, the archives are in time order. Its entries keep the path of the
 * backed-up folder under `app-data/` (`jellyfin/config/…`), so unzipping it into `app-data/`
 * restores it in place.
 */
export class AppBackups {
  /** An archive's name, without its extension */
  static readonly Archive = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

  private static readonly Extension = ".zip";

  /** An archive being written: renamed once complete, so a listing never offers a truncated one */
  private static readonly PartialExtension = ".zip.partial";

  private readonly backupsPath: string;

  private readonly appDataPath: string;

  /**
   * @param backupsPath Where the archives are kept, one folder per app
   * @param appDataPath Where the apps keep their data, one folder per app
   */
  constructor(backupsPath: string, appDataPath: string) {
    this.backupsPath = backupsPath;
    this.appDataPath = appDataPath;
  }

  /**
   * Archives an app's data folder, then removes the archives beyond `keep`, oldest first.
   * @param config The app's backup, as hangar.yml declares it
   * @param signal Aborts the archive; the partial file is removed
   */
  async create(config: BackupConfig, signal?: AbortSignal): Promise<BackupSummary> {
    const source = await this.source(config);
    const folder = this.folder(config.app);

    await mkdir(folder, { recursive: true });
    await AppBackups.removePartials(folder);

    const archive = AppBackups.stamp(new Date());
    const partial = path.join(folder, `${archive}${AppBackups.PartialExtension}`);
    const target = path.join(folder, `${archive}${AppBackups.Extension}`);
    const files = new BackupFiles(source, config.include, config.exclude);

    try {
      const count = await AppBackups.zip(files, AppBackups.entryPrefix(config), partial, signal);

      await rename(partial, target);

      const { size } = await stat(target);

      await this.prune(config.app, config.keep);

      return { archive, size, files: count, skippedLinks: files.skippedLinks() };
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  }

  /** The archives of an app, newest first; none when it was never backed up. */
  async list(app: string): Promise<BackupArchive[]> {
    const folder = this.folder(app);

    const names = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }

      throw error;
    });

    const archives = names
      .filter(name => name.endsWith(AppBackups.Extension))
      .map(name => name.slice(0, -AppBackups.Extension.length))
      .filter(archive => AppBackups.Archive.test(archive))
      .sort()
      .reverse();

    return Promise.all(
      archives.map(async archive => {
        const { size } = await stat(path.join(folder, `${archive}${AppBackups.Extension}`));

        return { archive, size, createdAt: AppBackups.createdAt(archive) };
      }),
    );
  }

  /**
   * One archive of an app, to download.
   * @throws NotFoundError when no such archive exists, or the names could not address one
   */
  async file(app: string, archive: string): Promise<BackupDownload> {
    const file = this.archivePath(app, archive);
    const { size } = await AppBackups.ifFound(stat(file), app, archive);

    return { path: file, size, downloadName: `${app}-${archive}${AppBackups.Extension}` };
  }

  /**
   * Removes one archive of an app.
   * @throws NotFoundError when no such archive exists, or the names could not address one
   */
  async remove(app: string, archive: string) {
    const file = this.archivePath(app, archive);

    await AppBackups.ifFound(rm(file), app, archive);
  }

  /** Removes the archives of an app beyond the `keep` newest. */
  private async prune(app: string, keep: number) {
    const archives = await this.list(app);

    for (const { archive } of archives.slice(keep)) {
      await rm(this.archivePath(app, archive), { force: true });
    }
  }

  /**
   * The folder to back up, links resolved: it must exist, and stay under `app-data/` even through a
   * link, since hangar.yml only checks the path as written.
   */
  private async source(config: BackupConfig) {
    const folder = path.join(this.appDataPath, AppBackups.entryPrefix(config));

    const resolved = await realpath(folder).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new HangarError(`${config.app} has no data folder to back up at ${folder}`);
      }

      throw error;
    });

    const root = await realpath(this.appDataPath);

    if (!resolved.startsWith(`${root}${path.sep}`)) {
      throw new HangarError(`The data folder of ${config.app} leads out of ${root}: ${folder}`);
    }

    return resolved;
  }

  /** The folder of an app's archives, once its id is known not to climb out of `app-backups/`. */
  private folder(app: string) {
    if (!AppId.isValid(app)) {
      throw new NotFoundError(`Invalid app id: ${app}`);
    }

    return path.join(this.backupsPath, app);
  }

  /** The file of one archive, once its name is known to be one. */
  private archivePath(app: string, archive: string) {
    if (!AppBackups.Archive.test(archive)) {
      throw new NotFoundError(`Invalid archive name: ${archive}`);
    }

    return path.join(this.folder(app), `${archive}${AppBackups.Extension}`);
  }

  /**
   * Writes the files into a new zip at `target`.
   * @returns How many files the archive holds
   */
  private static async zip(files: BackupFiles, prefix: string, target: string, signal?: AbortSignal) {
    const zip = new ZipFile();
    // yazl types its output as a bare readable; it is a PassThrough, which can be destroyed.
    const output = zip.outputStream as PassThrough;
    const written = pipeline(output, createWriteStream(target, { flags: "wx" }), { signal });

    // Awaited once every file is queued, which can be after it fails: a rejection with no handler yet
    // would crash the process meanwhile. The failure is not dropped: the `await` below rethrows it.
    written.catch(() => {});

    // yazl reports a file it cannot read on itself; failing the output fails `written` with it.
    zip.on("error", (error: Error) => output.destroy(error));

    let count = 0;

    try {
      for await (const file of files.entries()) {
        signal?.throwIfAborted();

        if (output.destroyed) {
          break;
        }

        const options = { mtime: file.stats.mtime, mode: file.stats.mode };

        // Lazy: one file open at a time. No `size`: a file still growing must not fail the archive.
        zip.addReadStreamLazy(`${prefix}/${file.relative}`, options, callback => {
          open(file.absolute, "r").then(
            handle => {
              const stream = handle.createReadStream();

              // yazl pipes the stream without listening to it: an unheard read error would crash the process.
              stream.once("error", error => output.destroy(error));
              callback(null, stream);
            },
            (error: unknown) => callback(error, undefined as never),
          );
        });

        count++;
      }

      zip.end();
    } catch (error) {
      output.destroy(error as Error);
    }

    await written;

    return count;
  }

  /** Removes the partial archives a run left behind when it was killed. */
  private static async removePartials(folder: string) {
    const names = await readdir(folder);

    await Promise.all(
      names
        .filter(name => name.endsWith(AppBackups.PartialExtension))
        .map(name => rm(path.join(folder, name), { force: true })),
    );
  }

  /** `operation`'s result, or a NotFoundError when the archive does not exist. */
  private static async ifFound<T>(operation: Promise<T>, app: string, archive: string): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(`${app} has no archive ${archive}`);
      }

      throw error;
    }
  }

  /** The backed-up folder, relative to `app-data/`: what every archive entry starts with. */
  private static entryPrefix(config: BackupConfig) {
    return config.path ?? config.app;
  }

  /** The name of an archive started at `date`: its ISO timestamp, with `-` for `:` and `.`. */
  static stamp(date: Date) {
    return date.toISOString().replaceAll(":", "-").replace(".", "-");
  }

  /** The ISO timestamp an archive name stands for. */
  private static createdAt(archive: string) {
    return archive.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
  }
}
