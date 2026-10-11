import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HangarRuntimeError } from "./hangar-error.ts";
import { HangarStore } from "./hangar-store.ts";
import type { CommandRunner } from "./runtime/runtime.ts";

const STORE_URL = "https://example.com/store.git";

/** The `hangar.yml` a cloned store ships; `beta-app` is in both categories, to exercise the dedupe. */
const CATEGORIES = `
categories:
  - name: essentials
    color: blue
    stacks: [alpha-app, beta-app]
  - name: utilities
    color: green
    stacks: [beta-app, gamma-app]
shared: [networks.yml]
`;

/** The copy of a compose file awaiting `docker compose config`, one per save, beside the real one. */
const PENDING_COMPOSE = /\/\.compose\.[0-9a-f-]{36}\.pending\.yml$/;

const createRuntime = () =>
  ({
    run: vi.fn<CommandRunner["run"]>(async () => ({ code: 0, stdout: "" })),
  }) satisfies CommandRunner;

/** A store whose configuration is already on disk and loaded, as after an install. */
const createStore = async (dataDir: string, runtime: CommandRunner) => {
  const store = new HangarStore(STORE_URL, dataDir, runtime);

  await mkdir(path.join(store.storePath, "config"), { recursive: true });
  await writeFile(path.join(store.storePath, "config", "hangar.yml"), CATEGORIES);
  await store.config.load();

  return store;
};

describe("HangarStore", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "hangar-store-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("creates paths relative to the data directory", async () => {
    const store = await createStore(dataDir, createRuntime());

    expect(store.dataPath).toBe(path.resolve(dataDir));
    expect(store.storePath).toBe(path.join(dataDir, "app-store"));
    expect(store.installedPath).toBe(path.join(dataDir, "app-installed"));
  });

  it("resolves all stacks, categories, and individual stack names", async () => {
    const store = await createStore(dataDir, createRuntime());

    expect(store.resolve()).toEqual(["alpha-app", "beta-app", "gamma-app"]);
    expect(store.resolve("essentials")).toEqual(["alpha-app", "beta-app"]);
    expect(store.resolve("custom-app")).toEqual(["custom-app"]);
  });

  it("installs a store that ships no config", async () => {
    const store = new HangarStore(STORE_URL, dataDir, createRuntime());

    await expect(store.install()).resolves.toBeUndefined();
  });

  it("links an available app without replacing an existing destination", async () => {
    const store = await createStore(dataDir, createRuntime());
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
    const store = await createStore(dataDir, runtime);

    await mkdir(path.join(store.storePath, ".git"), { recursive: true });

    await store.install();

    expect(runtime.run).toHaveBeenCalledOnce();
    expect(runtime.run).toHaveBeenCalledWith("git", ["-C", store.storePath, "pull", "--ff-only"]);
  });

  it("clones and links configured apps when installation is requested", async () => {
    const runtime: CommandRunner = {
      run: vi.fn(async () => {
        await Promise.all([
          mkdir(path.join(dataDir, "app-store", "store", "alpha-app"), { recursive: true }),
          mkdir(path.join(dataDir, "app-store", "store", "beta-app"), { recursive: true }),
          mkdir(path.join(dataDir, "app-store", "store", "gamma-app"), { recursive: true }),
          mkdir(path.join(dataDir, "app-store", "config"), { recursive: true }),
        ]);

        await Promise.all([
          writeFile(path.join(dataDir, "app-store", "config", "hangar.yml"), CATEGORIES),
          writeFile(path.join(dataDir, "app-store", "store", "networks.yml"), "networks: {}\n"),
        ]);

        return { code: 0, stdout: "" };
      }),
    };

    // No config up front: the categories it links by only arrive with the clone.
    const store = new HangarStore(STORE_URL, dataDir, runtime);

    await store.install();

    expect(runtime.run).toHaveBeenCalledWith("git", ["clone", "--", STORE_URL, store.storePath]);
    await expect(lstat(path.join(store.installedPath, "alpha-app"))).resolves.toMatchObject({});
    expect((await lstat(path.join(store.installedPath, "alpha-app"))).isSymbolicLink()).toBe(true);
    expect((await lstat(path.join(store.installedPath, "beta-app"))).isSymbolicLink()).toBe(true);
    expect((await lstat(path.join(store.installedPath, "gamma-app"))).isSymbolicLink()).toBe(true);
    // Shared files ride along with the stacks: compose resolves them from app-installed.
    expect(await readlink(path.join(store.installedPath, "networks.yml"))).toBe(
      path.join(store.storePath, "store", "networks.yml"),
    );
  });

  it("bootstraps the global env with the variables the stacks reference", async () => {
    const store = await createStore(dataDir, createRuntime());
    const alphaApp = path.join(store.storePath, "store", "alpha-app");

    await Promise.all([
      mkdir(path.join(store.storePath, ".git"), { recursive: true }),
      mkdir(alphaApp, { recursive: true }),
    ]);

    await Promise.all([
      writeFile(
        path.join(alphaApp, "compose.yml"),
        "services:\n  alpha:\n    image: alpha:${ALPHA_APP_TAG:-latest}\n    working_dir: ${PWD}\n    environment:\n      DOMAIN: $DOMAIN\n      DATA: ${APP_DATA_DIR}\n      PRICE: $$5\n",
      ),
      writeFile(path.join(store.storePath, "store", "networks.yml"), "networks:\n  web:\n    name: ${NETWORK}\n"),
    ]);

    await store.install();

    // Only the namespaced variables are seeded: PWD is compose's, `$$5` an escaped dollar, and
    // DOMAIN and NETWORK belong to no app, so they are the operator's to add.
    expect(await store.env.read()).toEqual({ ALPHA_APP_TAG: "", APP_DATA_DIR: path.join(dataDir, "app-data") });
  });

  it("keeps shared files out of the app list", async () => {
    const store = await createStore(dataDir, createRuntime());
    const alphaApp = path.join(store.storePath, "store", "alpha-app");

    await Promise.all([
      mkdir(path.join(store.storePath, ".git"), { recursive: true }),
      mkdir(alphaApp, { recursive: true }),
      mkdir(store.installedPath, { recursive: true }),
    ]);

    await Promise.all([
      writeFile(path.join(alphaApp, "compose.yml"), "services: {}\n"),
      writeFile(path.join(store.storePath, "store", "networks.yml"), "networks: {}\n"),
    ]);

    await store.refresh();

    expect([...store.apps].map(app => app.id)).toEqual(["alpha-app"]);
  });

  it("refreshes app metadata and installation state from disk", async () => {
    const store = await createStore(dataDir, createRuntime());
    const alphaApp = path.join(store.storePath, "store", "alpha-app");
    const betaApp = path.join(store.storePath, "store", "beta-app");

    await Promise.all([
      mkdir(path.join(store.storePath, ".git"), { recursive: true }),
      mkdir(alphaApp, { recursive: true }),
      mkdir(betaApp, { recursive: true }),
      mkdir(store.installedPath, { recursive: true }),
    ]);

    await Promise.all([
      writeFile(path.join(alphaApp, "compose.yml"), "name: Alpha App\nx-hangar:\n  icon: alpha.svg\n"),
      writeFile(path.join(betaApp, "compose.yml"), "x-hangar:\n  icon: beta.svg\n"),
      mkdir(path.join(store.installedPath, "alpha-app")),
    ]);

    await store.refresh();

    expect([...store.apps]).toEqual(
      expect.arrayContaining([
        {
          id: "alpha-app",
          name: "Alpha App",
          icon: "alpha.svg",
          installed: true,
          swarmReady: false,
          runsInSwarm: false,
          containerName: "alpha-app",
        },
        {
          id: "beta-app",
          name: "Beta-app",
          icon: "beta.svg",
          installed: false,
          swarmReady: false,
          runsInSwarm: false,
          containerName: "beta-app",
        },
      ]),
    );

    expect(store.apps).toHaveLength(2);
  });

  it("takes the container name from the app's own service, and only that one", async () => {
    const store = await createStore(dataDir, createRuntime());
    const named = path.join(store.storePath, "store", "frigate");
    const sidecarFirst = path.join(store.storePath, "store", "immich");

    await Promise.all([
      mkdir(path.join(store.storePath, ".git"), { recursive: true }),
      mkdir(named, { recursive: true }),
      mkdir(sidecarFirst, { recursive: true }),
      mkdir(store.installedPath, { recursive: true }),
    ]);

    await Promise.all([
      // The container the reverse proxy routes to is not the app's directory name.
      writeFile(path.join(named, "compose.yml"), "services:\n  frigate:\n    container_name: frigate-nvr\n"),
      // The app's own service is picked over the one declared before it.
      writeFile(
        path.join(sidecarFirst, "compose.yml"),
        "services:\n  redis:\n    container_name: immich-redis\n  immich:\n    container_name: immich-server\n",
      ),
    ]);

    await store.refresh();

    expect(store.app("frigate")?.containerName).toBe("frigate-nvr");
    expect(store.app("immich")?.containerName).toBe("immich-server");
  });

  it("keeps going when an app has no x-hangar block or no compose.yml", async () => {
    const store = await createStore(dataDir, createRuntime());
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
      writeFile(path.join(good, "compose.yml"), "name: Good\nx-hangar:\n  icon: good.svg\n"),
      writeFile(path.join(noMetadata, "compose.yml"), "name: No Metadata\nservices: {}\n"),
    ]);

    // refresh() runs in a module-level await on the server: a rejection here
    // would fail web app boot entirely rather than degrading one card.
    await expect(store.refresh()).resolves.toBeUndefined();

    expect([...store.apps]).toEqual(
      expect.arrayContaining([
        {
          id: "good-app",
          name: "Good",
          icon: "good.svg",
          installed: false,
          swarmReady: false,
          runsInSwarm: false,
          containerName: "good-app",
        },
        {
          id: "no-metadata-app",
          name: "No Metadata",
          icon: undefined,
          installed: false,
          swarmReady: false,
          runsInSwarm: false,
          containerName: "no-metadata-app",
        },
      ]),
    );

    expect(store.apps).toHaveLength(2);
  });

  it("clears stale app metadata when the store is absent", async () => {
    const store = await createStore(dataDir, createRuntime());

    store.apps.add({
      id: "old",
      name: "Old",
      icon: "old.svg",
      installed: true,
      swarmReady: false,
      runsInSwarm: false,
      containerName: "old",
    });

    await store.refresh();

    expect(store.apps).toHaveLength(0);
  });

  it("names an app after x-hangar.name, then its top-level name, then its folder", async () => {
    const store = await createStore(dataDir, createRuntime());
    const app = (id: string) => path.join(store.storePath, "store", id);

    await mkdir(path.join(store.storePath, ".git"), { recursive: true });
    await mkdir(store.installedPath, { recursive: true });
    await Promise.all(["both-app", "top-app", "plain-app"].map(id => mkdir(app(id), { recursive: true })));
    await Promise.all([
      writeFile(path.join(app("both-app"), "compose.yml"), "name: Top\nx-hangar:\n  name: Both\nservices: {}\n"),
      writeFile(path.join(app("top-app"), "compose.yml"), "name: Top\nservices: {}\n"),
      writeFile(path.join(app("plain-app"), "compose.yml"), "services: {}\n"),
    ]);

    await store.refresh();

    expect(store.app("both-app")?.name).toBe("Both");
    expect(store.app("top-app")?.name).toBe("Top");
    expect(store.app("plain-app")?.name).toBe("Plain-app");
  });

  it("tells which apps can run in the swarm, and which do", async () => {
    const store = await createStore(dataDir, createRuntime());
    const app = (id: string) => path.join(store.storePath, "store", id);

    await writeFile(path.join(store.storePath, "config", "hangar.yml"), `${CATEGORIES}swarm: [alpha-app]\n`);
    await mkdir(path.join(store.storePath, ".git"), { recursive: true });
    await mkdir(store.installedPath, { recursive: true });
    await Promise.all(["alpha-app", "beta-app"].map(id => mkdir(app(id), { recursive: true })));
    await Promise.all([
      writeFile(path.join(app("alpha-app"), "compose.yml"), "services: {}\n"),
      writeFile(path.join(app("alpha-app"), "compose.swarm.yml"), "services: {}\n"),
      writeFile(path.join(app("beta-app"), "compose.yml"), "services: {}\n"),
    ]);

    await store.refresh();

    expect(store.app("alpha-app")).toMatchObject({ swarmReady: true, runsInSwarm: true });
    expect(store.app("beta-app")).toMatchObject({ swarmReady: false, runsInSwarm: false });
  });

  it("leaves the apps that run in the swarm out of the installed compose projects", async () => {
    const store = await createStore(dataDir, createRuntime());

    store.apps.add({
      id: "a",
      name: "A",
      icon: undefined,
      installed: true,
      swarmReady: true,
      runsInSwarm: true,
      containerName: "a",
    });

    store.apps.add({
      id: "b",
      name: "B",
      icon: undefined,
      installed: true,
      swarmReady: true,
      runsInSwarm: false,
      containerName: "b",
    });

    expect(store.installedProjectIds()).toEqual(new Set(["b"]));
  });

  it("returns only installed app ids", async () => {
    const store = await createStore(dataDir, createRuntime());

    store.apps.add({
      id: "a",
      name: "A",
      icon: undefined,
      installed: true,
      swarmReady: false,
      runsInSwarm: false,
      containerName: "a",
    });

    store.apps.add({
      id: "b",
      name: "B",
      icon: undefined,
      installed: false,
      swarmReady: false,
      runsInSwarm: false,
      containerName: "b",
    });

    expect(store.installedProjectIds()).toEqual(new Set(["a"]));
  });

  it("looks up a store app by id", async () => {
    const store = await createStore(dataDir, createRuntime());

    store.apps.add({
      id: "a",
      name: "A",
      icon: undefined,
      installed: true,
      swarmReady: false,
      runsInSwarm: false,
      containerName: "a",
    });

    expect(store.app("a")).toMatchObject({ id: "a" });
    expect(store.app("missing")).toBeUndefined();
  });

  it("links and lists a stack a saved config adds", async () => {
    const store = await createStore(dataDir, createRuntime());

    await mkdir(store.installedPath, { recursive: true });
    await mkdir(path.join(store.storePath, ".git"));
    await mkdir(path.join(store.storePath, "store", "delta-app"), { recursive: true });
    await writeFile(path.join(store.storePath, "store", "delta-app", "compose.yml"), "services: {}\n");

    await store.saveConfig("categories:\n  - name: extra\n    color: red\n    stacks: [delta-app]\n");

    expect((await lstat(path.join(store.installedPath, "delta-app"))).isSymbolicLink()).toBe(true);
    expect(store.app("delta-app")?.installed).toBe(true);
  });

  describe("createApp", () => {
    const COMPOSE = "name: Delta\nservices:\n  delta-app:\n    image: nginx\n";

    it("adds a new app once docker compose accepts it", async () => {
      const runtime = createRuntime();
      const store = await createStore(dataDir, runtime);

      await mkdir(store.installedPath, { recursive: true });
      await mkdir(path.join(store.storePath, ".git"));

      await store.createApp("delta-app", COMPOSE);

      expect(await (await store.files("delta-app")).read("compose.yml")).toBe(COMPOSE);
      expect(store.app("delta-app")?.name).toBe("Delta");
      expect(runtime.run).toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining(["config", "-q", expect.stringMatching(PENDING_COMPOSE)]),
        { capture: true },
      );
    });

    it("leaves nothing behind when docker compose rejects a new app", async () => {
      const runtime = createRuntime();

      runtime.run.mockRejectedValueOnce(new HangarRuntimeError(1, "services must be a mapping"));
      const store = await createStore(dataDir, runtime);

      await expect(store.createApp("delta-app", "services: 3\n")).rejects.toThrow(/services must be a mapping/);
      await expect(lstat(path.join(store.storePath, "store", "delta-app"))).rejects.toThrow(/ENOENT/);
    });

    it("refuses ids that escape the store, shared files and creating an existing app", async () => {
      const store = await createStore(dataDir, createRuntime());

      await mkdir(path.join(store.storePath, "store", "delta-app"), { recursive: true });

      await expect(store.createApp("../config", COMPOSE)).rejects.toThrow(/Invalid app id/);
      await expect(store.createApp("networks.yml", COMPOSE)).rejects.toThrow(/shared/);
      await expect(store.createApp("delta-app", COMPOSE)).rejects.toThrow(/already exists/);
    });
  });

  describe("files", () => {
    const COMPOSE = "name: Delta\nservices:\n  delta-app:\n    image: nginx\n";

    /** A pending compose file an interrupted save left behind */
    const LEFTOVER_PENDING = ".compose.00000000-0000-0000-0000-000000000000.pending.yml";

    /** The pending compose files in an app folder */
    const pendingFiles = async (folder: string) =>
      (await readdir(folder)).filter(name => PENDING_COMPOSE.test(path.join(folder, name)));

    /** A store app on disk with its compose file, and a pending one an interrupted save left. */
    const withApp = async (runtime = createRuntime()) => {
      const store = await createStore(dataDir, runtime);
      const folder = path.join(store.storePath, "store", "delta-app");

      await mkdir(folder, { recursive: true });

      await Promise.all([
        writeFile(path.join(folder, "compose.yml"), COMPOSE),
        writeFile(path.join(folder, LEFTOVER_PENDING), "services: {}\n"),
      ]);

      return { store, runtime, folder };
    };

    it("writes the compose file only once docker compose accepts it", async () => {
      const { store, runtime, folder } = await withApp();
      const files = await store.files("delta-app");

      runtime.run.mockRejectedValueOnce(new HangarRuntimeError(1, "services must be a mapping"));

      await expect(files.write("compose.yml", "services: 3\n")).rejects.toThrow(/mapping/);
      expect(await files.read("compose.yml")).toBe(COMPOSE);
      expect(await pendingFiles(folder)).toEqual([LEFTOVER_PENDING]);

      await files.write("compose.yml", "name: Renamed\nservices: {}\n");

      expect(await files.read("compose.yml")).toBe("name: Renamed\nservices: {}\n");
      expect(runtime.run).toHaveBeenCalledWith("docker", expect.arrayContaining(["config", "-q"]), { capture: true });
    });

    it("validates two compose saves made at once, neither removing the other's pending copy", async () => {
      const { store, runtime, folder } = await withApp();
      const files = await store.files("delta-app");
      let releaseValidations = () => {};
      const bothValidating = new Promise<void>(resolve => (releaseValidations = resolve));
      const validated: string[] = [];

      runtime.run.mockImplementation(async (_command, args) => {
        const pending = args[args.indexOf("-f") + 1] ?? "";

        validated.push(await readFile(pending, "utf8"));

        if (validated.length === 2) {
          releaseValidations();
        }

        await bothValidating;

        return { code: 0, stdout: "" };
      });

      const first = "name: First\nservices: {}\n";
      const second = "name: Second\nservices: {}\n";

      await Promise.all([files.write("compose.yml", first), files.write("compose.yml", second)]);

      expect(validated.sort()).toEqual([first, second]);
      expect([first, second]).toContain(await files.read("compose.yml"));
      expect(await pendingFiles(folder)).toEqual([LEFTOVER_PENDING]);
      expect(await files.list()).toEqual(["compose.yml"]);
    });

    it("writes compose.swarm.yml once docker stack config accepts it merged over compose.yml", async () => {
      const { store, runtime, folder } = await withApp();
      const files = await store.files("delta-app");

      runtime.run.mockRejectedValueOnce(new HangarRuntimeError(1, "services.db.depends_on must be a list"));

      await expect(files.write("compose.swarm.yml", "services: {db: {}}\n")).rejects.toThrow(/must be a list/);
      await expect(files.read("compose.swarm.yml")).rejects.toThrow(/no file/);

      await files.write("compose.swarm.yml", "services: {}\n");

      expect(await files.read("compose.swarm.yml")).toBe("services: {}\n");
      expect(runtime.run).toHaveBeenLastCalledWith(
        "docker",
        ["stack", "config", "-c", path.join(folder, "compose.yml"), "-c", expect.stringMatching(/\.pending\.yml$/)],
        { capture: true, env: {} },
      );

      expect(store.app("delta-app")).toBeUndefined();
    });

    it("checks the stack again when compose.yml changes under a compose.swarm.yml", async () => {
      const { store, runtime, folder } = await withApp();
      const files = await store.files("delta-app");

      await writeFile(path.join(folder, "compose.swarm.yml"), "services: {}\n");
      runtime.run.mockResolvedValueOnce({ code: 0, stdout: "" });
      runtime.run.mockRejectedValueOnce(new HangarRuntimeError(1, "Additional property name is not allowed"));

      await expect(files.write("compose.yml", "name: Delta\nservices: {}\n")).rejects.toThrow(/name is not allowed/);
      expect(await files.read("compose.yml")).toBe(COMPOSE);
    });

    it("does not check the stack while compose.swarm.yml is still empty", async () => {
      const { store, runtime, folder } = await withApp();
      const files = await store.files("delta-app");

      await writeFile(path.join(folder, "compose.swarm.yml"), "");
      await files.write("compose.yml", "services: {}\n");

      expect(runtime.run).toHaveBeenCalledTimes(1);
    });

    it("refuses the files of a shared file or of a missing app", async () => {
      const { store } = await withApp();

      await expect(store.files("networks.yml")).rejects.toThrow(/shared/);
      await expect(store.files("other-app")).rejects.toThrow(/does not exist/);
    });
  });
});

describe("HangarStore.compose", () => {
  let dataDir: string;

  const withStacks = async (...stacks: string[]) => {
    const runtime = createRuntime();
    const store = await createStore(dataDir, runtime);

    await Promise.all(
      stacks.map(async stack => {
        await mkdir(path.join(store.installedPath, stack), { recursive: true });
        await writeFile(path.join(store.installedPath, stack, "compose.yml"), "services: {}\n");
      }),
    );

    return { store, runtime };
  };

  /** The stack each `docker compose` call targeted, read off the `-f <path>/compose.yml` argument. */
  const targets = (runtime: CommandRunner) =>
    (runtime.run as ReturnType<typeof vi.fn>).mock.calls.map(call => {
      const args = call[1] as string[];
      const compose = args.find(arg => arg.endsWith("compose.yml"));

      if (!compose) {
        throw new Error(`No compose file in: ${args.join(" ")}`);
      }

      return path.basename(path.dirname(compose));
    });

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "hangar-compose-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("runs a global command against every stack in order", async () => {
    const { store, runtime } = await withStacks("alpha-app", "beta-app", "gamma-app");

    await store.compose("up", ["-d"]);

    expect(targets(runtime)).toEqual(["alpha-app", "beta-app", "gamma-app"]);
    expect(runtime.run).toHaveBeenCalledWith(
      "docker",
      [
        "compose",
        "--env-file",
        path.join(store.dataPath, ".env.global"),
        "-p",
        "alpha-app",
        "-f",
        path.join(store.installedPath, "alpha-app", "compose.yml"),
        "up",
        "-d",
      ],
      undefined,
    );
  });

  it("pins the project name to the stack, not the compose file's display name", async () => {
    const { store, runtime } = await withStacks("alpha-app");

    await writeFile(path.join(store.installedPath, "alpha-app", "compose.yml"), "name: Alpha App\nservices: {}\n");

    await store.compose("alpha-app", ["up", "-d"]);

    expect(runtime.run).toHaveBeenCalledWith(
      "docker",
      [
        "compose",
        "--env-file",
        path.join(store.dataPath, ".env.global"),
        "-p",
        "alpha-app",
        "-f",
        path.join(store.installedPath, "alpha-app", "compose.yml"),
        "up",
        "-d",
      ],
      undefined,
    );
  });

  it("reverses the order for down", async () => {
    const { store, runtime } = await withStacks("alpha-app", "beta-app", "gamma-app");

    await store.compose("down", []);

    expect(targets(runtime)).toEqual(["gamma-app", "beta-app", "alpha-app"]);
  });

  it("restricts a category command to its stacks", async () => {
    const { store, runtime } = await withStacks("alpha-app", "beta-app", "gamma-app");

    await store.compose("essentials", ["restart"]);

    expect(targets(runtime)).toEqual(["alpha-app", "beta-app"]);
  });

  it("refuses an attached up across several stacks", async () => {
    const { store, runtime } = await withStacks("alpha-app", "beta-app");

    await expect(store.compose("up", [])).rejects.toThrow("Non detached mode");
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("rejects when a stack is not installed", async () => {
    const { store, runtime } = await withStacks("alpha-app");

    await expect(store.compose("missing-app", ["logs"])).rejects.toThrow("Failed to find project: missing-app");
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("stops an ordered run at the first failure but completes an unordered one", async () => {
    const { store } = await withStacks("alpha-app", "beta-app", "gamma-app");

    const failing = vi.fn(async (_c: string, args: string[]) => {
      if (args.some(arg => arg.includes("beta-app"))) {
        throw new HangarRuntimeError(2, "boom");
      }

      return { code: 0 };
    });

    Object.assign(store, { runtime: { run: failing } });

    await expect(store.compose("up", ["-d"])).rejects.toMatchObject({ code: 2 });
    expect(failing).toHaveBeenCalledTimes(2);

    failing.mockClear();
    await expect(store.compose("essentials", ["logs"])).rejects.toMatchObject({ code: 2 });
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe("HangarStore.compose and the swarm", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "hangar-compose-swarm-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const withSwarmApp = async () => {
    const runtime = createRuntime();
    const store = await createStore(dataDir, runtime);

    await writeFile(path.join(store.storePath, "config", "hangar.yml"), `${CATEGORIES}swarm: [beta-app]\n`);
    await store.config.load();
    await Promise.all(
      ["alpha-app", "beta-app", "gamma-app"].map(async stack => {
        await mkdir(path.join(store.installedPath, stack), { recursive: true });
        await writeFile(path.join(store.installedPath, stack, "compose.yml"), "services: {}\n");
      }),
    );

    return { store, runtime };
  };

  /** The `-p` project each `docker compose` call targeted. */
  const projects = (runtime: ReturnType<typeof createRuntime>) =>
    runtime.run.mock.calls.map(([, args]) => args[args.indexOf("-p") + 1]);

  it("leaves the swarm apps out of a store or category command", async () => {
    const { store, runtime } = await withSwarmApp();

    await store.compose("up", ["-d"]);
    await store.compose("essentials", ["restart"]);

    expect(projects(runtime)).toEqual(["alpha-app", "gamma-app", "alpha-app"]);
  });

  it("refuses a swarm app named directly, pointing at the swarm command", async () => {
    const { store, runtime } = await withSwarmApp();

    await expect(store.compose("beta-app", ["up", "-d"])).rejects.toThrow("use `swarm beta-app`");
    expect(runtime.run).not.toHaveBeenCalled();
  });
});

describe("HangarStore.stack", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "hangar-stack-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  /** Installed apps; the swarm-ready ones get a compose.swarm.yml, and `swarm:` lists `listed`. */
  const withApps = async ({ ready, listed }: { ready: string[]; listed: string[] }) => {
    const runtime = createRuntime();
    const store = await createStore(dataDir, runtime);
    const swarm = listed.length ? `swarm: [${listed.join(", ")}]\n` : "";

    await writeFile(path.join(store.storePath, "config", "hangar.yml"), `${CATEGORIES}${swarm}`);
    await writeFile(path.join(store.dataPath, ".env.global"), "DOMAIN=home.lan\n");
    await store.config.load();
    await Promise.all(
      ["alpha-app", "beta-app", "gamma-app", "solo-app"].map(async app => {
        await mkdir(path.join(store.installedPath, app), { recursive: true });
        await writeFile(path.join(store.installedPath, app, "compose.yml"), "services: {}\n");

        if (ready.includes(app)) {
          await writeFile(path.join(store.installedPath, app, "compose.swarm.yml"), "services: {}\n");
        }
      }),
    );

    return { store, runtime };
  };

  /** The stack each call named: its last argument, which `deploy`, `rm` and `ps` end with. */
  const stacks = (runtime: ReturnType<typeof createRuntime>) => runtime.run.mock.calls.map(([, args]) => args.at(-1));

  it("deploys an app from its two files, with .env.global in the environment", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app"], listed: [] });
    const folder = path.join(store.installedPath, "alpha-app");

    await store.stack("alpha-app", ["deploy", "--prune"]);

    expect(runtime.run).toHaveBeenCalledWith(
      "docker",
      [
        "stack",
        "deploy",
        "-c",
        path.join(folder, "compose.yml"),
        "-c",
        path.join(folder, "compose.swarm.yml"),
        "--prune",
        "alpha-app",
      ],
      { env: { DOMAIN: "home.lan" } },
    );
  });

  it("maps each verb to its docker stack call", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app"], listed: [] });
    const folder = path.join(store.installedPath, "alpha-app");
    const files = ["-c", path.join(folder, "compose.yml"), "-c", path.join(folder, "compose.swarm.yml")];

    for (const verb of [["config"], ["rm"], ["ps", "--no-trunc"], ["services"]]) {
      await store.stack("alpha-app", verb);
    }

    expect(runtime.run.mock.calls.map(([, args]) => args)).toEqual([
      ["stack", "config", ...files],
      ["stack", "rm", "alpha-app"],
      ["stack", "ps", "--no-trunc", "alpha-app"],
      ["stack", "services", "alpha-app"],
    ]);
  });

  it("deploys every swarm: app in category order, those no category lists last, and removes them backwards", async () => {
    const { store, runtime } = await withApps({
      ready: ["alpha-app", "gamma-app", "solo-app"],
      listed: ["solo-app", "gamma-app", "alpha-app"],
    });

    await store.stack("deploy", []);

    expect(stacks(runtime)).toEqual(["alpha-app", "gamma-app", "solo-app"]);

    runtime.run.mockClear();
    await store.stack("rm", []);

    expect(stacks(runtime)).toEqual(["solo-app", "gamma-app", "alpha-app"]);
  });

  it("restricts a category to its swarm: apps", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app", "beta-app"], listed: ["beta-app"] });

    await store.stack("essentials", ["deploy"]);

    expect(stacks(runtime)).toEqual(["beta-app"]);
  });

  it("manages an app named directly without it being listed, as a stack deployed by hand", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app"], listed: [] });

    await store.stack("alpha-app", ["rm"]);

    expect(stacks(runtime)).toEqual(["alpha-app"]);
  });

  it("refuses an app without compose.swarm.yml, and an unknown verb", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app"], listed: [] });

    await expect(store.stack("beta-app", ["deploy"])).rejects.toThrow("beta-app is not a swarm app");
    await expect(store.stack("alpha-app", ["scale"])).rejects.toThrow("Unknown swarm command: scale");
    expect(runtime.run).not.toHaveBeenCalled();
  });
});
