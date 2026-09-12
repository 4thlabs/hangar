import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lstat, mkdir, mkdtemp, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ConfigurationProvider } from "./hangar-config.ts";
import type { CommandRunner } from "./runtime/runtime.ts";
import { HangarStore } from "./hangar-store.ts";
import { HangarRuntimeError } from "./hangar-error.ts";

const config: ConfigurationProvider = {
  storeUrl: () => "https://example.com/store.git",
  categories: () => [
    { name: "essentials", color: "blue", stacks: ["alpha-app", "beta-app"] },
    { name: "utilities", color: "green", stacks: ["beta-app", "gamma-app"] },
  ],
};

const createRuntime = () =>
  ({
    run: vi.fn(async () => ({ code: 0 })),
  }) satisfies CommandRunner;

describe("HangarStore", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "hangar-store-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("creates paths relative to the data directory", async () => {
    const store = await HangarStore.create(config, dataDir, createRuntime());

    expect(store.dataPath).toBe(path.resolve(dataDir));
    expect(store.storePath).toBe(path.join(dataDir, "app-store"));
    expect(store.installedPath).toBe(path.join(dataDir, "app-installed"));
  });

  it("resolves all stacks, categories, and individual stack names", async () => {
    const store = await HangarStore.create(config, dataDir, createRuntime());

    expect(store.resolve()).toEqual(["alpha-app", "beta-app", "gamma-app"]);
    expect(store.resolve("essentials")).toEqual(["alpha-app", "beta-app"]);
    expect(store.resolve("custom-app")).toEqual(["custom-app"]);
  });

  it("links an available app without replacing an existing destination", async () => {
    const store = await HangarStore.create(config, dataDir, createRuntime());
    const source = path.join(store.storePath, "store", "alpha-app");
    const destination = path.join(store.installedPath, "alpha-app");
    await mkdir(source, { recursive: true });
    await mkdir(store.installedPath, { recursive: true });

    await store.link("alpha-app");

    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
    expect(await readlink(destination)).toBe(source);

    await store.link("alpha-app");
    expect(await readlink(destination)).toBe(source);
  });

  it("pulls an installed store", async () => {
    const runtime = createRuntime();
    const store = await HangarStore.create(config, dataDir, runtime);
    await mkdir(path.join(store.storePath, ".git"), { recursive: true });

    await store.update();

    expect(runtime.run).toHaveBeenCalledOnce();
    expect(runtime.run).toHaveBeenCalledWith("git", "-C", store.storePath, "pull", "--ff-only");
  });

  it("clones and links configured apps when installation is requested", async () => {
    const runtime: CommandRunner = {
      run: vi.fn(async () => {
        await Promise.all([
          mkdir(path.join(dataDir, "app-store", "store", "alpha-app"), { recursive: true }),
          mkdir(path.join(dataDir, "app-store", "store", "beta-app"), { recursive: true }),
          mkdir(path.join(dataDir, "app-store", "store", "gamma-app"), { recursive: true }),
        ]);
        return { code: 0 };
      }),
    };
    const store = await HangarStore.create(config, dataDir, runtime);

    await store.update(true);

    expect(runtime.run).toHaveBeenCalledWith("git", "clone", "--", "https://example.com/store.git", store.storePath);
    await expect(lstat(path.join(store.installedPath, "alpha-app"))).resolves.toMatchObject({});
    expect((await lstat(path.join(store.installedPath, "alpha-app"))).isSymbolicLink()).toBe(true);
    expect((await lstat(path.join(store.installedPath, "beta-app"))).isSymbolicLink()).toBe(true);
    expect((await lstat(path.join(store.installedPath, "gamma-app"))).isSymbolicLink()).toBe(true);
  });

  it("does nothing when the store is absent and installation is not requested", async () => {
    const runtime = createRuntime();
    const store = await HangarStore.create(config, dataDir, runtime);

    await store.update();

    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("refreshes app metadata and installation state from disk", async () => {
    const store = await HangarStore.create(config, dataDir, createRuntime());
    const alphaApp = path.join(store.storePath, "store", "alpha-app");
    const betaApp = path.join(store.storePath, "store", "beta-app");
    await Promise.all([
      mkdir(path.join(store.storePath, ".git"), { recursive: true }),
      mkdir(alphaApp, { recursive: true }),
      mkdir(betaApp, { recursive: true }),
      mkdir(store.installedPath, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(alphaApp, "compose.yml"), "name: Alpha App\nx-arcane:\n  icon: alpha.svg\n"),
      writeFile(path.join(betaApp, "compose.yml"), "x-arcane:\n  icon: beta.svg\n"),
      mkdir(path.join(store.installedPath, "alpha-app")),
    ]);

    await store.refresh();

    expect([...store.apps]).toEqual(
      expect.arrayContaining([
        { id: "alpha-app", name: "Alpha App", icon: "alpha.svg", installed: true },
        { id: "beta-app", name: "beta-app", icon: "beta.svg", installed: false },
      ]),
    );
    expect(store.apps).toHaveLength(2);
  });

  it("keeps going when an app has no x-arcane block or no compose.yml", async () => {
    const store = await HangarStore.create(config, dataDir, createRuntime());
    const good = path.join(store.storePath, "store", "good-app");
    const noMetadata = path.join(store.storePath, "store", "no-metadata-app");
    const noCompose = path.join(store.storePath, "store", "no-compose-app");
    await Promise.all([
      mkdir(path.join(store.storePath, ".git"), { recursive: true }),
      mkdir(good, { recursive: true }),
      mkdir(noMetadata, { recursive: true }),
      mkdir(noCompose, { recursive: true }),
      mkdir(store.installedPath, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(good, "compose.yml"), "name: Good\nx-arcane:\n  icon: good.svg\n"),
      writeFile(path.join(noMetadata, "compose.yml"), "name: No Metadata\nservices: {}\n"),
    ]);

    // refresh() runs in a module-level await on the server: a rejection here
    // would fail web app boot entirely rather than degrading one card.
    await expect(store.refresh()).resolves.toBeUndefined();

    expect([...store.apps]).toEqual(
      expect.arrayContaining([
        { id: "good-app", name: "Good", icon: "good.svg", installed: false },
        { id: "no-metadata-app", name: "No Metadata", icon: undefined, installed: false },
      ]),
    );
    expect(store.apps).toHaveLength(2);
  });

  it("clears stale app metadata when the store is absent", async () => {
    const store = await HangarStore.create(config, dataDir, createRuntime());
    store.apps.add({ id: "old", name: "Old", icon: "old.svg", installed: true });

    await store.refresh();

    expect(store.apps).toHaveLength(0);
  });
});

describe("HangarStore.compose", () => {
  let dataDir: string;

  const withStacks = async (...stacks: string[]) => {
    const runtime = createRuntime();
    const store = await HangarStore.create(config, dataDir, runtime);
    await Promise.all(
      stacks.map(async stack => {
        await mkdir(path.join(store.installedPath, stack), { recursive: true });
        await writeFile(path.join(store.installedPath, stack, "compose.yml"), "services: {}\n");
      }),
    );
    return { store, runtime };
  };

  const targets = (runtime: CommandRunner) =>
    (runtime.run as ReturnType<typeof vi.fn>).mock.calls.map(call => path.basename(path.dirname(call[5])));

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "hangar-compose-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("runs a global command against every stack in order", async () => {
    const { store, runtime } = await withStacks("alpha-app", "beta-app", "gamma-app");

    await store.compose("up", "-d");

    expect(targets(runtime)).toEqual(["alpha-app", "beta-app", "gamma-app"]);
    expect(runtime.run).toHaveBeenCalledWith(
      "docker",
      "compose",
      "--env-file",
      path.join(store.installedPath, ".env.global"),
      "-f",
      path.join(store.installedPath, "alpha-app", "compose.yml"),
      "up",
      "-d",
    );
  });

  it("reverses the order for down", async () => {
    const { store, runtime } = await withStacks("alpha-app", "beta-app", "gamma-app");

    await store.compose("down");

    expect(targets(runtime)).toEqual(["gamma-app", "beta-app", "alpha-app"]);
  });

  it("restricts a category command to its stacks", async () => {
    const { store, runtime } = await withStacks("alpha-app", "beta-app", "gamma-app");

    await store.compose("essentials", "restart");

    expect(targets(runtime)).toEqual(["alpha-app", "beta-app"]);
  });

  it("refuses an attached up across several stacks", async () => {
    const { store, runtime } = await withStacks("alpha-app", "beta-app");

    await expect(store.compose("up")).rejects.toThrow("Non detached mode");
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("rejects when a stack is not installed", async () => {
    const { store, runtime } = await withStacks("alpha-app");

    await expect(store.compose("missing-app", "logs")).rejects.toThrow("Failed to find project: missing-app");
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("stops an ordered run at the first failure but completes an unordered one", async () => {
    const { store } = await withStacks("alpha-app", "beta-app", "gamma-app");
    const failing = vi.fn(async (_c: string, ...args: string[]) => {
      if (args.some(arg => arg.includes("beta-app"))) throw new HangarRuntimeError(2, "boom");
      return { code: 0 };
    });
    Object.assign(store, { runtime: { run: failing } });

    await expect(store.compose("up", "-d")).rejects.toMatchObject({ code: 2 });
    expect(failing).toHaveBeenCalledTimes(2);

    failing.mockClear();
    await expect(store.compose("essentials", "logs")).rejects.toMatchObject({ code: 2 });
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
