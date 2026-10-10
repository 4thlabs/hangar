import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditableFile } from "./editable-file.ts";
import { HangarError } from "./hangar-error.ts";

describe("EditableFile.write", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), "editable-file-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(folder, { recursive: true, force: true });
  });

  it("rewrites an existing file in place, keeping its inode and its mode", async () => {
    const file = path.join(folder, "traefik.yml");

    await writeFile(file, "entryPoints:\n  web:\n    address: ':80'\n");
    await chmod(file, 0o640);

    const before = await stat(file);

    await EditableFile.write(file, "traefik.yml", "log: {}\n");

    const after = await stat(file);

    expect(await readFile(file, "utf8")).toBe("log: {}\n");
    expect(after.ino).toBe(before.ino);
    expect(after.mode).toBe(before.mode);
  });

  it("refuses a symlink swapped in for the file after its path was resolved, and leaves its target untouched", async () => {
    const target = path.join(folder, "target.env");
    const swapped = path.join(folder, "settings.env");

    await writeFile(target, "SECRET=1\n");
    await symlink(target, swapped);

    await expect(EditableFile.write(swapped, "settings.env", "SECRET=2\n")).rejects.toThrow(HangarError);
    await expect(EditableFile.write(swapped, "settings.env", "SECRET=2\n")).rejects.toThrow(
      /settings\.env is not a file/,
    );

    expect(await readFile(target, "utf8")).toBe("SECRET=1\n");
  });

  it("creates a missing file and its folders", async () => {
    const file = path.join(folder, "config", "nginx", "site.conf");

    await EditableFile.write(file, "config/nginx/site.conf", "server { listen 80 }\n");

    expect(await readFile(file, "utf8")).toBe("server { listen 80 }\n");
  });

  it("refuses to save a new file over one that appeared since it was found missing", async () => {
    const file = path.join(folder, "notes.txt");
    const finder = EditableFile as unknown as { openExisting: () => Promise<undefined> };

    await writeFile(file, "written meanwhile\n");
    // The file is found missing, then appears before it is created.
    vi.spyOn(finder, "openExisting").mockResolvedValueOnce(undefined);

    await expect(EditableFile.write(file, "notes.txt", "mine\n")).rejects.toThrow(/notes\.txt appeared while/);
    expect(await readFile(file, "utf8")).toBe("written meanwhile\n");
  });

  it("refuses a folder", async () => {
    await expect(EditableFile.write(folder, "config", "a: 1\n")).rejects.toThrow(/config is not a file/);
  });
});
