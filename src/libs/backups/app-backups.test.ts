import * as fs from "node:fs/promises";
import { chmod, mkdir, mkdtemp, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openPromise, type Entry } from "yauzl";
import { HangarError, NotFoundError, type BackupConfig } from "#libs/hangar";
import { AppBackups } from "./app-backups.ts";

const mocks = vi.hoisted(() => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("#libs/logs", () => ({ logger: mocks.logger }));

// The real filesystem, with `open`, `stat` and `rm` spied on: a test makes one of them fail as a
// live app or a concurrent removal would.
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();

  return { ...actual, open: vi.fn(actual.open), stat: vi.fn(actual.stat), rm: vi.fn(actual.rm) };
});

/** The error a path gets once removed. */
function gone(file: string) {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${file}'`), { code: "ENOENT" });
}

/** Makes `operation` fail with `error` on `file`, and run for real on every other path. */
async function failOn(operation: "open" | "stat" | "rm", file: string, error: Error) {
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  const real = actual[operation] as (...args: unknown[]) => Promise<unknown>;

  vi.mocked(fs[operation]).mockImplementation((async (target: unknown, ...rest: unknown[]) => {
    if (target === file) {
      throw error;
    }

    return real(target, ...rest);
  }) as never);
}

/** A data directory with `app-data/` and `app-backups/`, and the backups over it. */
async function dataDir() {
  const root = await mkdtemp(path.join(tmpdir(), "hangar-backups-"));
  const appData = path.join(root, "app-data");
  const backupsPath = path.join(root, "app-backups");

  await mkdir(appData);

  return { root, appData, backupsPath, backups: new AppBackups(backupsPath, appData) };
}

/** Writes each file, creating its folders, under `root`. */
async function files(root: string, contents: Record<string, string>) {
  for (const [relative, content] of Object.entries(contents)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
}

/** The entries of a zip, by name, with their text. */
async function unzip(file: string) {
  const zip = await openPromise(file, { lazyEntries: true });
  const entries: Record<string, string> = {};

  const read = new Promise<void>((resolve, reject) => {
    zip.on("entry", (entry: Entry) => {
      zip
        .openReadStreamPromise(entry)
        .then(stream => text(stream))
        .then(content => {
          entries[entry.fileName] = content;
          zip.readEntry();
        }, reject);
    });

    zip.once("end", resolve);
    zip.once("error", reject);
  });

  zip.readEntry();
  await read;

  return entries;
}

/** A backup as hangar.yml declares it once defaulted. */
function backupOf(app: string, overrides: Partial<BackupConfig> = {}): BackupConfig {
  return { app, keep: 7, stop: false, include: ["**"], exclude: [], ...overrides };
}

describe("AppBackups", () => {
  afterEach(async () => {
    const actual = await vi.importActual<typeof fs>("node:fs/promises");

    vi.useRealTimers();
    vi.clearAllMocks();
    vi.mocked(fs.open).mockImplementation(actual.open);
    vi.mocked(fs.stat).mockImplementation(actual.stat);
    vi.mocked(fs.rm).mockImplementation(actual.rm);
  });

  it("archives the app's data folder, dotfiles included, under its path in app-data", async () => {
    const { appData, backupsPath, backups } = await dataDir();

    await files(path.join(appData, "jellyfin"), { "config/system.xml": "<xml/>", ".config/token": "secret" });

    const summary = await backups.create(backupOf("jellyfin"));

    expect(summary).toMatchObject({ files: 2, skippedLinks: 0 });
    expect(summary.archive).toMatch(AppBackups.Archive);
    expect(await unzip(path.join(backupsPath, "jellyfin", `${summary.archive}.zip`))).toEqual({
      "jellyfin/.config/token": "secret",
      "jellyfin/config/system.xml": "<xml/>",
    });
  });

  it("keeps the files the include globs match, and skips the excluded ones and folders", async () => {
    const { appData, backupsPath, backups } = await dataDir();

    await files(path.join(appData, "jellyfin"), {
      "config/system.xml": "<xml/>",
      "config/cache/image.jpg": "jpg",
      "config/log/today.log": "log",
      "transcodes/movie.ts": "ts",
    });

    const summary = await backups.create(
      backupOf("jellyfin", { include: ["config/**"], exclude: ["**/cache/**", "**/*.log"] }),
    );

    expect(Object.keys(await unzip(path.join(backupsPath, "jellyfin", `${summary.archive}.zip`)))).toEqual([
      "jellyfin/config/system.xml",
    ]);
  });

  it("archives the folder `path` names, entries prefixed with it", async () => {
    const { appData, backupsPath, backups } = await dataDir();

    await files(path.join(appData, "miniflux"), { "db/data.sql": "sql", "cache/feed": "feed" });

    const summary = await backups.create(backupOf("miniflux", { path: "miniflux/db" }));

    expect(await unzip(path.join(backupsPath, "miniflux", `${summary.archive}.zip`))).toEqual({
      "miniflux/db/data.sql": "sql",
    });
  });

  it("leaves out a symbolic link, and counts it", async () => {
    const { root, appData, backupsPath, backups } = await dataDir();

    await files(root, { "outside/secret": "secret" });
    await files(path.join(appData, "jellyfin"), { "config/system.xml": "<xml/>" });
    await symlink(path.join(root, "outside"), path.join(appData, "jellyfin", "outside"));

    const summary = await backups.create(backupOf("jellyfin"));

    expect(summary).toMatchObject({ files: 1, skippedLinks: 1 });
    expect(Object.keys(await unzip(path.join(backupsPath, "jellyfin", `${summary.archive}.zip`)))).toEqual([
      "jellyfin/config/system.xml",
    ]);
  });

  it("refuses a data folder that a link leads out of app-data", async () => {
    const { root, appData, backups } = await dataDir();

    await files(root, { "outside/secret": "secret" });
    await symlink(path.join(root, "outside"), path.join(appData, "jellyfin"));

    await expect(backups.create(backupOf("jellyfin"))).rejects.toThrow(/leads out of/);
  });

  it("fails with the folder named when the app has no data folder", async () => {
    const { backups } = await dataDir();

    await expect(backups.create(backupOf("jellyfin"))).rejects.toThrow(HangarError);
    await expect(backups.create(backupOf("jellyfin"))).rejects.toThrow(/app-data\/jellyfin/);
  });

  it("keeps the `keep` newest archives, and lists them newest first", async () => {
    const { appData, backups } = await dataDir();

    await files(path.join(appData, "jellyfin"), { "config/system.xml": "<xml/>" });
    vi.useFakeTimers({ toFake: ["Date"] });

    for (const day of ["2026-10-16", "2026-10-17", "2026-10-18"]) {
      vi.setSystemTime(new Date(`${day}T03:30:00.000Z`));
      await backups.create(backupOf("jellyfin", { keep: 2 }));
    }

    const archives = await backups.list("jellyfin");

    expect(archives.map(archive => archive.createdAt)).toEqual([
      "2026-10-18T03:30:00.000Z",
      "2026-10-17T03:30:00.000Z",
    ]);

    expect(archives[0]?.archive).toBe("2026-10-18T03-30-00-000Z");
  });

  it("lists only complete archives, and removes a partial one at the next backup", async () => {
    const { appData, backupsPath, backups } = await dataDir();
    const folder = path.join(backupsPath, "jellyfin");

    await files(path.join(appData, "jellyfin"), { "config/system.xml": "<xml/>" });
    await files(folder, { "2026-10-17T03-30-00-000Z.zip.partial": "", "notes.zip": "", "readme.txt": "" });

    expect(await backups.list("jellyfin")).toEqual([]);

    const { archive } = await backups.create(backupOf("jellyfin"));

    expect((await readdir(folder)).sort()).toEqual([`${archive}.zip`, "notes.zip", "readme.txt"]);
  });

  it("lists no archive for an app never backed up", async () => {
    const { backups } = await dataDir();

    expect(await backups.list("jellyfin")).toEqual([]);
  });

  it("hands over an archive to download, and removes it", async () => {
    const { appData, backupsPath, backups } = await dataDir();

    await files(path.join(appData, "jellyfin"), { "config/system.xml": "<xml/>" });

    const { archive, size } = await backups.create(backupOf("jellyfin"));

    expect(await backups.file("jellyfin", archive)).toEqual({
      path: path.join(backupsPath, "jellyfin", `${archive}.zip`),
      size,
      downloadName: `jellyfin-${archive}.zip`,
    });

    await backups.remove("jellyfin", archive);

    expect(await backups.list("jellyfin")).toEqual([]);
    await expect(backups.file("jellyfin", archive)).rejects.toThrow(NotFoundError);
  });

  it.each([
    ["../jellyfin", "2026-10-18T03-30-00-000Z"],
    ["jellyfin", "../../app-data/jellyfin"],
    ["jellyfin", "2026-10-18T03-30-00-000Z.zip"],
    ["jellyfin", "a/b"],
  ])("refuses to address an archive from %s and %s", async (app, archive) => {
    const { backups } = await dataDir();

    await expect(backups.file(app, archive)).rejects.toThrow(NotFoundError);
    await expect(backups.remove(app, archive)).rejects.toThrow(NotFoundError);
  });

  // Root reads the file whatever its mode.
  it.skipIf(process.getuid?.() === 0)("fails on a file it cannot read, leaving no archive behind", async () => {
    const { appData, backupsPath, backups } = await dataDir();

    await files(path.join(appData, "jellyfin"), { "config/system.xml": "<xml/>", "config/locked": "secret" });
    await chmod(path.join(appData, "jellyfin", "config", "locked"), 0o000);

    await expect(backups.create(backupOf("jellyfin"))).rejects.toThrow(/EACCES/);
    expect(await readdir(path.join(backupsPath, "jellyfin"))).toEqual([]);
  });

  it("leaves out a file removed after the walk listed it, and archives the rest", async () => {
    const { appData, backupsPath, backups } = await dataDir();
    const journal = path.join(appData, "jellyfin", "data", "library.db-journal");

    await files(path.join(appData, "jellyfin"), { "data/library.db": "db", "data/library.db-journal": "journal" });
    await failOn("open", journal, gone(journal));

    const summary = await backups.create(backupOf("jellyfin"));

    expect(summary.files).toBe(1);
    expect(await unzip(path.join(backupsPath, "jellyfin", `${summary.archive}.zip`))).toEqual({
      "jellyfin/data/library.db": "db",
    });
  });

  it("lists the archives still there when one is removed meanwhile", async () => {
    const { backupsPath, backups } = await dataDir();
    const folder = path.join(backupsPath, "jellyfin");
    const removed = path.join(folder, "2026-10-17T03-30-00-000Z.zip");

    await files(folder, { "2026-10-17T03-30-00-000Z.zip": "", "2026-10-18T03-30-00-000Z.zip": "" });

    await failOn("stat", removed, gone(removed));

    expect((await backups.list("jellyfin")).map(archive => archive.archive)).toEqual(["2026-10-18T03-30-00-000Z"]);
  });

  it("succeeds with its archive written when an old one cannot be removed", async () => {
    const { appData, backupsPath, backups } = await dataDir();
    const folder = path.join(backupsPath, "jellyfin");
    const old = path.join(folder, "2026-10-17T03-30-00-000Z.zip");

    await files(path.join(appData, "jellyfin"), { "config/system.xml": "<xml/>" });
    await files(folder, { "2026-10-17T03-30-00-000Z.zip": "" });

    await failOn("rm", old, Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" }));

    const summary = await backups.create(backupOf("jellyfin", { keep: 1 }));

    expect((await readdir(folder)).sort()).toEqual(["2026-10-17T03-30-00-000Z.zip", `${summary.archive}.zip`]);
    expect(mocks.logger.warn).toHaveBeenCalledWith("Failed to remove the oldest archives", expect.anything());
  });

  it("leaves no archive behind when aborted", async () => {
    const { appData, backupsPath, backups } = await dataDir();
    const contents = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`file-${index}`, "x".repeat(1024)]));

    await files(path.join(appData, "jellyfin"), contents);

    await expect(backups.create(backupOf("jellyfin"), AbortSignal.abort())).rejects.toThrow(/abort/i);
    expect(await readdir(path.join(backupsPath, "jellyfin"))).toEqual([]);
  });
});
