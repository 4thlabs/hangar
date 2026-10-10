import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { logger } from "#libs/logs";
import { HangarError } from "./hangar-error.ts";

/** An entry of an app folder met by the listing, by its path relative to that folder. */
type ListedEntry = { relativePath: string; isFile: boolean; isFolder: boolean };

/**
 * The files of an app folder the editor may open: regular UTF-8 text files, small enough to ship to
 * a browser whole. Paths given here are already resolved and known to stay inside the app folder.
 */
export class EditableFile {
  /** The largest file the editor opens: it is sent to the browser whole, and saved back the same way */
  private static readonly MaxSize = 1024 * 1024;

  /** How much of a file is read to tell text from binary, as much as git reads */
  private static readonly BinarySniffLength = 8000;

  /** How many folders deep a listing goes: an app may bind-mount its data (`./data`) into its folder */
  private static readonly MaxListedDepth = 5;

  /** How many files a listing reads at most, for the same reason */
  private static readonly MaxListedFiles = 500;

  /** No blocking on a FIFO, and no following a symlink swapped in after the path was resolved */
  private static readonly ReadFlags = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;

  /** Refuses invalid UTF-8 instead of replacing it, and keeps a byte order mark so a save writes it back */
  private static readonly Utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

  /**
   * The editable files under `folder`, as relative paths, sorted. Hidden entries, symlinks, binaries
   * and files over the size limit are left out, and so is anything that cannot be read, with a
   * warning: one unreadable entry must not hide the others.
   */
  static async list(folder: string) {
    const candidates = await EditableFile.listCandidates(folder);
    const files: string[] = [];

    // One file at a time: a listing may hold hundreds, more than the open files a process gets.
    for (const relativePath of candidates) {
      if (await EditableFile.isListed(folder, relativePath)) {
        files.push(relativePath);
      }
    }

    return files.sort();
  }

  /**
   * The content of a file the editor may open.
   * @param file The file, symlinks resolved
   * @param relativePath The file's path inside its app folder, named in the errors
   * @throws {HangarError} When it is not a regular file, is too large, binary or not UTF-8 text
   */
  static async read(file: string, relativePath: string) {
    const content = await EditableFile.readWhole(file, relativePath);

    if (content.subarray(0, EditableFile.BinarySniffLength).includes(0)) {
      throw new HangarError(`${relativePath} is not a text file`);
    }

    try {
      return EditableFile.Utf8.decode(content);
    } catch {
      throw new HangarError(`${relativePath} is not UTF-8 text: saving it from the editor would corrupt it`);
    }
  }

  /**
   * Writes `source` to `file`, creating its missing folders. The content goes to a hidden file
   * beside it first, renamed onto `file` once complete: a symlink swapped in for `file` after its
   * path was checked is then replaced, not followed.
   * @param file The file, symlinks resolved
   * @param relativePath The file's path inside its app folder, named in the errors
   */
  static async write(file: string, relativePath: string, source: string) {
    await mkdir(path.dirname(file), { recursive: true });

    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);

    try {
      await EditableFile.writeReplacement(temporary, file, relativePath, source);
      await rename(temporary, file);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  /**
   * Writes `source` to `temporary`, a new file meant to be renamed onto `file`, with the mode and
   * owner `file` has: a container may need both to read it.
   * @throws {HangarError} When `file` exists but is not a regular file
   */
  static async writeReplacement(temporary: string, file: string, relativePath: string, source: string) {
    const current = await stat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    });

    if (current && !current.isFile()) {
      throw new HangarError(`${relativePath} is not a file`);
    }

    // `wx`: a path already taken, a planted symlink included, fails instead of being written through.
    const handle = await open(temporary, "wx");

    try {
      await handle.writeFile(source, "utf8");

      if (current) {
        await EditableFile.copyOwnership(handle, current);
      }
    } finally {
      await handle.close();
    }
  }

  /**
   * Creates `file` empty, and its missing folders.
   * @throws {HangarError} When anything exists at that path, whatever it is
   */
  static async create(file: string, relativePath: string) {
    await mkdir(path.dirname(file), { recursive: true });

    // An exclusive create refuses an existing entry, a symlink or a file the listing hides included,
    // where checking first would leave a gap before the write.
    const handle = await open(file, "wx").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") {
        throw new HangarError(`${relativePath} already exists`);
      }

      throw error;
    });

    await handle.close();
  }

  private static async copyOwnership(handle: FileHandle, original: Stats) {
    const written = await handle.stat();

    await handle.chmod(original.mode & 0o7777);

    // Only root may give a file away: a process editing its own files keeps them as they are.
    if (written.uid !== original.uid || written.gid !== original.gid) {
      await handle.chown(original.uid, original.gid);
    }
  }

  /** The whole of a regular file, read once its size is known to fit. */
  private static async readWhole(file: string, relativePath: string) {
    const handle = await open(file, EditableFile.ReadFlags);

    try {
      const stats = await handle.stat();

      if (!stats.isFile()) {
        throw new HangarError(`${relativePath} is not a file`);
      }

      if (stats.size > EditableFile.MaxSize) {
        throw new HangarError(
          `${relativePath} is too large to edit here: ${stats.size} bytes, ${EditableFile.MaxSize / 1024 / 1024} MiB at most`,
        );
      }

      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  /** The visible regular files under `folder`, breadth first, within the listing's depth and count. */
  private static async listCandidates(folder: string) {
    const files: string[] = [];
    let folders = [""];

    for (let depth = 0; depth <= EditableFile.MaxListedDepth && folders.length > 0; depth++) {
      const levels = await Promise.all(
        folders.map(relativeFolder => EditableFile.visibleEntries(folder, relativeFolder)),
      );

      const entries = levels.flat();

      files.push(...entries.filter(entry => entry.isFile).map(entry => entry.relativePath));
      folders = entries.filter(entry => entry.isFolder).map(entry => entry.relativePath);

      if (files.length >= EditableFile.MaxListedFiles) {
        break;
      }
    }

    const isPartial = folders.length > 0 || files.length > EditableFile.MaxListedFiles;

    if (isPartial) {
      logger.warn("An app folder is listed only in part", {
        folder,
        maxDepth: EditableFile.MaxListedDepth,
        maxFiles: EditableFile.MaxListedFiles,
      });
    }

    return files.slice(0, EditableFile.MaxListedFiles);
  }

  /** The entries of one folder the listing may show, none when it cannot be read. */
  private static async visibleEntries(folder: string, relativeFolder: string): Promise<ListedEntry[]> {
    try {
      const entries = await readdir(path.join(folder, relativeFolder), { withFileTypes: true });

      return entries
        .filter(entry => !entry.name.startsWith("."))
        .map(entry => ({
          relativePath: path.join(relativeFolder, entry.name),
          isFile: entry.isFile(),
          isFolder: entry.isDirectory(),
        }));
    } catch (error) {
      logger.warn("Skipping an unreadable folder of an app", { error, folder, relativeFolder });

      return [];
    }
  }

  /** Whether the listing shows a file; one it cannot read is skipped with a warning. */
  private static async isListed(folder: string, relativePath: string) {
    try {
      return await EditableFile.isSmallTextFile(path.join(folder, relativePath));
    } catch (error) {
      logger.warn("Skipping an unreadable file of an app", { error, folder, relativePath });

      return false;
    }
  }

  /** A regular file within the size limit, text by git's heuristic: no NUL byte in its first few kilobytes. */
  private static async isSmallTextFile(file: string) {
    const handle = await open(file, EditableFile.ReadFlags);

    try {
      const stats = await handle.stat();

      if (!stats.isFile() || stats.size > EditableFile.MaxSize) {
        return false;
      }

      const head = Buffer.alloc(Math.min(EditableFile.BinarySniffLength, stats.size));
      const { bytesRead } = await handle.read(head, 0, head.length, 0);

      return !head.subarray(0, bytesRead).includes(0);
    } finally {
      await handle.close();
    }
  }
}
