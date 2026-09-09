import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "./config.ts";
import { install, isStoreInstalled, update } from "./management.ts";

const execFileAsync = promisify(execFile);

const git = async (cwd: string, ...args: string[]) => {
  await execFileAsync("git", args, { cwd });
};

describe("store management", () => {
  let rootPath: string;
  let sourcePath: string;
  let remotePath: string;
  let previousDataPath: string;
  let previousStoreUrl: string;
  let previousCategories: typeof config.categories;

  beforeEach(async () => {
    rootPath = await mkdtemp(path.join(tmpdir(), "hangar-store-"));
    sourcePath = path.join(rootPath, "source");
    remotePath = path.join(rootPath, "remote.git");
    previousDataPath = process.env.HANGAR_DATA_DIR;
    previousStoreUrl = config.store;
    previousCategories = config.categories;

    await mkdir(sourcePath);
    await git(rootPath, "init", "--bare", remotePath);
    await git(sourcePath, "init");
    await git(sourcePath, "config", "user.email", "hangar@example.com");
    await git(sourcePath, "config", "user.name", "Hangar Test");
    await mkdir(path.join(sourcePath, "alpha"));
    await writeFile(path.join(sourcePath, "alpha", "version.txt"), "one");
    await git(sourcePath, "add", ".");
    await git(sourcePath, "commit", "-m", "Initial store");
    await git(sourcePath, "remote", "add", "origin", remotePath);
    await git(sourcePath, "push", "-u", "origin", "HEAD");

    process.env.HANGAR_DATA_DIR = path.join(rootPath, "data");
    config.store = remotePath;
    config.categories = [{ name: "test", color: "blue", stacks: ["alpha"] }];
  });

  afterEach(async () => {
    process.env.HANGAR_DATA_DIR = previousDataPath;
    config.store = previousStoreUrl;
    config.categories = previousCategories;
    await rm(rootPath, { recursive: true, force: true });
  });

  it("clones the store and links configured stacks on the first installation", async () => {
    expect(await isStoreInstalled()).toBe(false);

    await expect(install()).resolves.toBe(0);

    expect(await isStoreInstalled()).toBe(true);
    await expect(readlink(path.join(process.env.HANGAR_DATA_DIR, "app-installed", "alpha"))).resolves.toBe(
      path.join(process.env.HANGAR_DATA_DIR, "store", "alpha"),
    );
  });

  it("updates the current branch with a fast-forward", async () => {
    await expect(install()).resolves.toBe(0);
    await writeFile(path.join(sourcePath, "alpha", "version.txt"), "two");
    await git(sourcePath, "add", ".");
    await git(sourcePath, "commit", "-m", "Update store");
    await git(sourcePath, "push");

    await expect(update()).resolves.toBe(0);

    await expect(
      readFile(path.join(process.env.HANGAR_DATA_DIR, "store", "alpha", "version.txt"), "utf8"),
    ).resolves.toBe("two");
  });

  it("refuses to update a store that is not installed", async () => {
    await expect(update()).resolves.toBe(1);
  });

  it("returns Git's failure code when cloning fails", async () => {
    config.store = path.join(rootPath, "missing.git");

    await expect(install()).resolves.not.toBe(0);
    expect(await isStoreInstalled()).toBe(false);
  });
});
