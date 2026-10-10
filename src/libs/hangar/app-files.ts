import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { AppFileSyntax } from "./app-file-syntax.ts";
import { EditableFile } from "./editable-file.ts";
import { HangarError, NotFoundError } from "./hangar-error.ts";

/**
 * Writes `source` to `target`, the compose file of the app in `folder`, once `docker compose config`
 * accepts it. A rejected source leaves the file untouched.
 */
export type ComposeWriter = (folder: string, target: string, source: string) => Promise<void>;

/** A file of a store app, with symlinks resolved. */
type AppFileLocation = {
  /** The app folder */
  folder: string;
  /** The file, inside the app folder; it may not exist yet */
  file: string;
};

/**
 * The files of one store app, by their path relative to its folder (`config/settings.yml`). Every path
 * is checked to stay inside the folder before anything is read or written.
 */
export class AppFiles {
  /** The file that makes a folder under `store/` an app, validated by `docker compose config` */
  static readonly ComposeFile = "compose.yml";

  private readonly id: string;

  private readonly folder: string;

  private readonly writeCompose: ComposeWriter;

  /**
   * @param id The app id, named in the errors
   * @param folder The app folder, which must exist
   * @param writeCompose How the app's compose file is written: it needs the runtime to be validated
   */
  constructor(id: string, folder: string, writeCompose: ComposeWriter) {
    this.id = id;
    this.folder = folder;
    this.writeCompose = writeCompose;
  }

  /**
   * The text files of the app, as relative paths, sorted. Hidden files (`.compose.<uuid>.pending.yml`),
   * binaries, symlinks and files too large to edit are left out: none of them is the operator's to
   * edit. The listing stops a few folders deep and after a few hundred files, and skips what it cannot
   * read: an app may bind-mount its data into its folder.
   */
  async list() {
    return EditableFile.list(this.folder);
  }

  /**
   * One text file of the app.
   * @param relativePath The file's path inside the app folder, as {@link list} gives it
   */
  async read(relativePath: string) {
    const { file } = await this.locate(relativePath);

    try {
      return await EditableFile.read(file, relativePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(`The app ${this.id} has no file ${relativePath}`);
      }

      throw error;
    }
  }

  /**
   * Writes one file of the app, creating it and its folders when missing, once its syntax checks out:
   * `docker compose config` for the app's compose.yml, whatever path leads to it, a parse for YAML and
   * env files, nothing for the others. A rejected source leaves the file untouched.
   * @param relativePath The file's path inside the app folder (`config/settings.yml`)
   * @param source The file's new content
   * @returns Whether the app's compose file was written, which may rename the app or change its icon
   */
  async write(relativePath: string, source: string): Promise<{ composeChanged: boolean }> {
    const location = await this.locate(relativePath);

    if (await AppFiles.isComposeFile(location)) {
      await this.writeCompose(location.folder, location.file, source);

      return { composeChanged: true };
    }

    AppFileSyntax.check(relativePath, source);
    await EditableFile.write(location.file, relativePath, source);

    return { composeChanged: false };
  }

  /**
   * Creates an empty file in the app, and its folders when missing.
   * @param relativePath The file's path inside the app folder; nothing may exist there yet, not even
   * a file the listing hides
   */
  async create(relativePath: string) {
    const { file } = await this.locate(relativePath);

    await EditableFile.create(file, relativePath);
  }

  /**
   * Where a file of the app really is, once its path is known to stay inside the app folder: no NUL
   * byte, no absolute path, no `..`, no hidden segment, nothing going through a file, and no
   * symlink leading out of the folder. Both paths come with symlinks resolved, so a write lands
   * where the check looked; a file that does not exist yet is placed under its closest existing folder.
   */
  private async locate(relativePath: string): Promise<AppFileLocation> {
    const segments = relativePath.split("/");

    // A leading dot covers `.` and `..` too, and keeps the files the listing hides out of reach.
    const isMalformed =
      relativePath.includes("\0") ||
      path.isAbsolute(relativePath) ||
      segments.some(segment => segment === "" || segment.startsWith("."));

    if (isMalformed) {
      throw new HangarError(`Invalid file path: ${relativePath}`);
    }

    const [realFolder, realFile] = await Promise.all([
      realpath(this.folder),
      AppFiles.realpathOfExisting(path.join(this.folder, ...segments)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOTDIR") {
          throw new HangarError(`${relativePath} goes through a file, not a folder`);
        }

        throw error;
      }),
    ]);

    if (!AppFiles.isInside(realFolder, realFile)) {
      throw new HangarError(`${relativePath} leads outside the app ${this.id}`);
    }

    return { folder: realFolder, file: realFile };
  }

  /**
   * Whether a located file is the app's compose file, which `docker compose config` must accept:
   * reached through a symlink (`alias.yml`), or spelled in another case (`Compose.yml`), which a
   * case-insensitive file system takes for the same file.
   */
  private static async isComposeFile({ folder, file }: AppFileLocation) {
    const compose = await AppFiles.realpathOfExisting(path.join(folder, AppFiles.ComposeFile));
    const isAtRoot = path.dirname(file) === folder;

    return file === compose || (isAtRoot && path.basename(file).toLowerCase() === AppFiles.ComposeFile);
  }

  /** Whether `target` is `folder` or under it, both with symlinks resolved. */
  private static isInside(folder: string, target: string) {
    const relativePath = path.relative(folder, target);

    return !(relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath));
  }

  /**
   * The real path of `target`, or while it does not exist yet, the real path of its closest existing
   * ancestor joined with the rest. A dangling symlink is refused: writing through it would create its
   * target, wherever it points.
   */
  private static async realpathOfExisting(target: string): Promise<string> {
    try {
      return await realpath(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const link = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    });

    if (link?.isSymbolicLink()) {
      throw new HangarError(`${path.basename(target)} is a broken symlink`);
    }

    return path.join(await AppFiles.realpathOfExisting(path.dirname(target)), path.basename(target));
  }
}
