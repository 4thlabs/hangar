import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFiles, type ComposeWriter } from "./app-files.ts";
import { HangarError, HangarRuntimeError } from "./hangar-error.ts";

const COMPOSE = "name: Delta\nservices:\n  delta-app:\n    image: nginx\n";

/** A pending compose file an interrupted save left behind */
const LEFTOVER_PENDING = ".compose.00000000-0000-0000-0000-000000000000.pending.yml";

describe("AppFiles", () => {
  let dataDir: string;
  let folder: string;

  /** Stands in for `docker compose config`: writes what it is given, as an accepted save does. */
  const writeCompose = vi.fn<ComposeWriter>(async (_folder, target, source) => writeFile(target, source));

  /** An app folder with a compose file, an env file, a nested config and the files the listing skips. */
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "hangar-app-files-"));
    folder = path.join(dataDir, "delta-app");
    writeCompose.mockClear();

    await mkdir(path.join(folder, "config"), { recursive: true });
    await mkdir(path.join(folder, ".cache"), { recursive: true });

    await Promise.all([
      writeFile(path.join(folder, "compose.yml"), COMPOSE),
      writeFile(path.join(folder, "delta.env"), "DELTA_PORT=8080\n"),
      writeFile(path.join(folder, "config", "settings.yml"), "theme: dark\n"),
      writeFile(path.join(folder, LEFTOVER_PENDING), "services: {}\n"),
      writeFile(path.join(folder, ".cache", "state.json"), "{}"),
      writeFile(path.join(folder, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a])),
    ]);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const createFiles = () => new AppFiles("delta-app", folder, writeCompose);

  it("lists the text files of an app, nested ones by their relative path, without hidden or binary files", async () => {
    await symlink(path.join(folder, "delta.env"), path.join(folder, "linked.env"));

    expect(await createFiles().list()).toEqual(["compose.yml", "config/settings.yml", "delta.env"]);
  });

  it("reads a file of an app", async () => {
    const files = createFiles();

    expect(await files.read("config/settings.yml")).toBe("theme: dark\n");
    await expect(files.read("missing.yml")).rejects.toThrow(/has no file/);
    await expect(files.read("logo.png")).rejects.toThrow(/not a text file/);
  });

  it("hands the root compose.yml to the compose writer, and leaves it untouched when the writer refuses", async () => {
    const files = createFiles();

    writeCompose.mockRejectedValueOnce(new HangarRuntimeError(1, "services must be a mapping"));

    await expect(files.write("compose.yml", "services: 3\n")).rejects.toThrow(/mapping/);
    expect(await files.read("compose.yml")).toBe(COMPOSE);

    await expect(files.write("compose.yml", "name: Renamed\nservices: {}\n")).resolves.toEqual({
      composeChanged: true,
    });

    expect(writeCompose).toHaveBeenLastCalledWith(
      await realpath(folder),
      await realpath(path.join(folder, "compose.yml")),
      "name: Renamed\nservices: {}\n",
    );
  });

  it("parses other YAML files instead of handing them to the compose writer", async () => {
    const files = createFiles();

    await expect(files.write("config/settings.yml", "theme: [dark\n")).rejects.toThrow(/settings\.yml/);

    expect(await files.read("config/settings.yml")).toBe("theme: dark\n");

    await files.write("config/settings.yml", "theme: light\n");

    expect(await files.read("config/settings.yml")).toBe("theme: light\n");
    expect(writeCompose).not.toHaveBeenCalled();
  });

  it("rejects an env file with a line that declares no variable, quoted multi-line values aside", async () => {
    const files = createFiles();

    await expect(files.write("delta.env", "DELTA_PORT=9090\nDELTA HOST\n")).rejects.toThrow(/delta\.env, line 2/);

    expect(await files.read("delta.env")).toBe("DELTA_PORT=8080\n");

    const multiline = '# Ports\nDELTA_PORT=9090\n\nDELTA_KEY="-----BEGIN KEY-----\nabc\n-----END KEY-----"\n';

    await files.write("delta.env", multiline);

    expect(await files.read("delta.env")).toBe(multiline);
  });

  it("writes any other file as is, creating it and its folders when missing", async () => {
    const files = createFiles();

    await files.write("config/nginx/site.conf", "server { listen 80 }\n");
    await files.write("notes.txt", "");

    expect(await readFile(path.join(folder, "config", "nginx", "site.conf"), "utf8")).toBe("server { listen 80 }\n");
    expect(await files.list()).toContain("notes.txt");
  });

  it("skips what it cannot read, files too large to edit and folders too deep, and lists the rest", async () => {
    const tooDeep = path.join(folder, "a", "b", "c", "d", "e", "f");

    await mkdir(path.join(folder, "locked"));
    await writeFile(path.join(folder, "locked", "hidden.yml"), "a: 1\n");
    await writeFile(path.join(folder, "large.log"), "x".repeat(1024 * 1024 + 1));
    await mkdir(tooDeep, { recursive: true });
    await writeFile(path.join(tooDeep, "deep.yml"), "a: 1\n");
    await writeFile(path.join(folder, "a", "b", "c", "d", "e", "shallow.yml"), "a: 1\n");
    await chmod(path.join(folder, "locked"), 0o000);

    try {
      expect(await createFiles().list()).toEqual([
        "a/b/c/d/e/shallow.yml",
        "compose.yml",
        "config/settings.yml",
        "delta.env",
      ]);
    } finally {
      await chmod(path.join(folder, "locked"), 0o755);
    }
  });

  it("refuses to open a file too large to edit, or one that is not UTF-8 text", async () => {
    const files = createFiles();

    await writeFile(path.join(folder, "large.log"), "x".repeat(1024 * 1024 + 1));
    await writeFile(path.join(folder, "latin1.conf"), Buffer.from("caf\xe9\n", "latin1"));

    await expect(files.read("large.log")).rejects.toThrow(/too large/);
    await expect(files.read("latin1.conf")).rejects.toThrow(/not UTF-8/);
  });

  it("creates an empty file and its folders", async () => {
    await createFiles().create("config/nginx/site.conf");

    expect(await readFile(path.join(folder, "config", "nginx", "site.conf"), "utf8")).toBe("");
  });

  it("refuses to create a file over anything already there, binaries and symlinks included", async () => {
    const files = createFiles();

    await symlink(path.join(folder, "delta.env"), path.join(folder, "linked.env"));

    await expect(files.create("logo.png")).rejects.toThrow(/logo\.png already exists/);
    await expect(files.create("linked.env")).rejects.toThrow(/linked\.env already exists/);
    await expect(files.create("delta.env")).rejects.toThrow(HangarError);
    expect((await readFile(path.join(folder, "logo.png"))).length).toBe(6);
    expect(await readFile(path.join(folder, "delta.env"), "utf8")).toBe("DELTA_PORT=8080\n");
  });

  it("hands the compose file to the compose writer whatever path leads to it", async () => {
    const files = createFiles();
    const compose = await realpath(path.join(folder, "compose.yml"));

    await symlink("compose.yml", path.join(folder, "alias.yml"));

    await expect(files.write("alias.yml", "name: Aliased\nservices: {}\n")).resolves.toEqual({ composeChanged: true });
    expect(writeCompose).toHaveBeenLastCalledWith(await realpath(folder), compose, "name: Aliased\nservices: {}\n");
    expect((await lstat(path.join(folder, "alias.yml"))).isSymbolicLink()).toBe(true);

    // A case-insensitive file system takes it for compose.yml.
    await expect(files.write("Compose.yml", "services: {}\n")).resolves.toEqual({ composeChanged: true });
    expect(writeCompose).toHaveBeenCalledTimes(2);
  });

  it("rewrites a file in place, keeping the inode a container mounting it holds, and its mode", async () => {
    const file = path.join(folder, "delta.env");

    await chmod(file, 0o640);

    const before = await stat(file);

    await expect(createFiles().write("delta.env", "DELTA_PORT=9090\n")).resolves.toEqual({ composeChanged: false });

    const after = await stat(file);

    expect(await readFile(file, "utf8")).toBe("DELTA_PORT=9090\n");
    expect(after.ino).toBe(before.ino);
    expect(after.mode & 0o777).toBe(0o640);
  });

  it("refuses a path with a NUL byte or going through a file as invalid, not as a server failure", async () => {
    const files = createFiles();

    await expect(files.read("compose\0.yml")).rejects.toThrow(/Invalid file path/);
    await expect(files.write("compose.yml/x.yml", "a: 1\n")).rejects.toThrow(/goes through a file/);
    await expect(files.create("compose.yml/x.yml")).rejects.toThrow(HangarError);
  });

  it("refuses paths that climb out, are absolute or hidden, and folders taken for files", async () => {
    const files = createFiles();

    await expect(files.read("../alpha-app/compose.yml")).rejects.toThrow(/Invalid file path/);
    await expect(files.write("config/../../x.yml", "")).rejects.toThrow(/Invalid file path/);
    await expect(files.write("/etc/passwd", "")).rejects.toThrow(/Invalid file path/);
    await expect(files.write(LEFTOVER_PENDING, "")).rejects.toThrow(/Invalid file path/);
    await expect(files.write("config", "")).rejects.toThrow(/not a file/);
  });

  it("refuses a symlink that leads out of the app folder, dangling or not", async () => {
    const files = createFiles();
    const outside = path.join(dataDir, "outside");

    await mkdir(outside);
    await writeFile(path.join(outside, "secret.env"), "SECRET=1\n");
    await symlink(outside, path.join(folder, "escape"), "dir");
    await symlink(path.join(outside, "secret.env"), path.join(folder, "secret.env"));
    await symlink(path.join(outside, "created.yml"), path.join(folder, "dangling.yml"));

    await expect(files.read("escape/secret.env")).rejects.toThrow(/outside the app/);
    await expect(files.read("secret.env")).rejects.toThrow(/outside the app/);
    await expect(files.write("escape/new.yml", "a: 1\n")).rejects.toThrow(/outside the app/);
    await expect(files.write("dangling.yml", "a: 1\n")).rejects.toThrow(/broken symlink/);
    await expect(lstat(path.join(outside, "new.yml"))).rejects.toThrow(/ENOENT/);
    await expect(lstat(path.join(outside, "created.yml"))).rejects.toThrow(/ENOENT/);
  });
});
