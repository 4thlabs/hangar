import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "#libs/logs";
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
    expect(store.appsPath).toBe(path.join(dataDir, "app-store", "store"));
  });

  it("reserves the store command's words for category names, and leaves the swarm's free", () => {
    expect([...HangarStore.CliWords].sort()).toEqual(["down", "install", "ls", "pull", "up"]);
  });

  it("tells the whole store, a category and an app apart", async () => {
    const store = await createStore(dataDir, createRuntime());

    expect(store.target()).toEqual({ kind: "all" });
    expect(store.target("essentials")).toEqual({ kind: "category", name: "essentials" });
    expect(store.target("custom-app")).toEqual({ kind: "app", id: "custom-app" });
  });

  it("installs a store that ships no config", async () => {
    const store = new HangarStore(STORE_URL, dataDir, createRuntime());

    await expect(store.install()).resolves.toBeUndefined();
  });

  it("pulls a store already cloned", async () => {
    const runtime = createRuntime();
    const store = await createStore(dataDir, runtime);

    await mkdir(path.join(store.storePath, ".git"), { recursive: true });

    await store.install();

    expect(runtime.run).toHaveBeenCalledOnce();
    expect(runtime.run).toHaveBeenCalledWith("git", ["-C", store.storePath, "pull", "--ff-only"]);
  });

  it("clones the store on its first install, and keeps no state of its own beside it", async () => {
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

    // No config up front: the categories only arrive with the clone.
    const store = new HangarStore(STORE_URL, dataDir, runtime);

    await store.install();

    expect(runtime.run).toHaveBeenCalledWith("git", ["clone", "--", STORE_URL, store.storePath]);
    expect(store.config.entries().map(entry => entry.id)).toEqual(["alpha-app", "beta-app", "gamma-app"]);
    // hangar.yml declares, Docker says what runs: no installed state is written next to the clone.
    expect((await readdir(dataDir)).sort()).toEqual([".env.global", "app-store"]);
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

  it("lists as apps only the folders holding a compose file", async () => {
    const store = await createStore(dataDir, createRuntime());
    const alphaApp = path.join(store.storePath, "store", "alpha-app");

    await Promise.all([
      mkdir(path.join(store.storePath, ".git"), { recursive: true }),
      mkdir(alphaApp, { recursive: true }),
    ]);

    await Promise.all([
      writeFile(path.join(alphaApp, "compose.yml"), "services: {}\n"),
      // A shared fragment, listed nowhere: it is no folder, so no app.
      writeFile(path.join(store.storePath, "store", "networks.yml"), "networks: {}\n"),
      mkdir(path.join(store.storePath, "store", "docs"), { recursive: true }),
      mkdir(path.join(store.storePath, "store", ".github"), { recursive: true }),
    ]);

    await store.refresh();

    expect([...store.apps].map(app => app.id)).toEqual(["alpha-app"]);
  });

  it("refreshes app metadata from disk", async () => {
    const store = await createStore(dataDir, createRuntime());
    const alphaApp = path.join(store.storePath, "store", "alpha-app");
    const betaApp = path.join(store.storePath, "store", "beta-app");

    await Promise.all([
      mkdir(path.join(store.storePath, ".git"), { recursive: true }),
      mkdir(alphaApp, { recursive: true }),
      mkdir(betaApp, { recursive: true }),
    ]);

    await Promise.all([
      writeFile(path.join(alphaApp, "compose.yml"), "name: Alpha App\nx-hangar:\n  icon: alpha.svg\n"),
      writeFile(path.join(betaApp, "compose.yml"), "x-hangar:\n  icon: beta.svg\n"),
    ]);

    await store.refresh();

    expect([...store.apps]).toEqual(
      expect.arrayContaining([
        {
          id: "alpha-app",
          name: "Alpha App",
          icon: "alpha.svg",
          swarmReady: false,
          containerName: "alpha-app",
        },
        {
          id: "beta-app",
          name: "Beta-app",
          icon: "beta.svg",
          swarmReady: false,
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

  it("keeps going when an app has no x-hangar block, and skips a folder with no compose.yml", async () => {
    const store = await createStore(dataDir, createRuntime());
    const good = path.join(store.storePath, "store", "good-app");
    const noMetadata = path.join(store.storePath, "store", "no-metadata-app");
    const noCompose = path.join(store.storePath, "store", "no-compose-app");

    await Promise.all([
      mkdir(path.join(store.storePath, ".git"), { recursive: true }),
      mkdir(good, { recursive: true }),
      mkdir(noMetadata, { recursive: true }),
      mkdir(noCompose, { recursive: true }),
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
          swarmReady: false,
          containerName: "good-app",
        },
        {
          id: "no-metadata-app",
          name: "No Metadata",
          icon: undefined,
          swarmReady: false,
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
      swarmReady: false,
      containerName: "old",
    });

    await store.refresh();

    expect(store.apps).toHaveLength(0);
  });

  it("names an app after x-hangar.name, then its top-level name, then its folder", async () => {
    const store = await createStore(dataDir, createRuntime());
    const app = (id: string) => path.join(store.storePath, "store", id);

    await mkdir(path.join(store.storePath, ".git"), { recursive: true });
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

    await mkdir(path.join(store.storePath, ".git"), { recursive: true });
    await Promise.all(["alpha-app", "beta-app"].map(id => mkdir(app(id), { recursive: true })));
    await Promise.all([
      writeFile(path.join(app("alpha-app"), "compose.yml"), "services: {}\n"),
      writeFile(path.join(app("alpha-app"), "compose.swarm.yml"), "services: {}\n"),
      writeFile(path.join(app("beta-app"), "compose.yml"), "services: {}\n"),
    ]);

    await store.refresh();

    expect(store.app("alpha-app")).toMatchObject({ swarmReady: true });
    expect(store.app("beta-app")).toMatchObject({ swarmReady: false });
  });

  it("names the declared apps and every app of the store, for the Docker layer", async () => {
    const store = await createStore(dataDir, createRuntime());

    store.apps.add({ id: "alpha-app", name: "Alpha", icon: undefined, swarmReady: false, containerName: "alpha-app" });
    store.apps.add({ id: "solo-app", name: "Solo", icon: undefined, swarmReady: false, containerName: "solo-app" });

    expect(store.declaredAppIds()).toEqual(new Set(["alpha-app", "beta-app", "gamma-app"]));
    expect(store.appIds()).toEqual(new Set(["alpha-app", "solo-app"]));
  });

  it("looks up a store app by id", async () => {
    const store = await createStore(dataDir, createRuntime());

    store.apps.add({
      id: "a",
      name: "A",
      icon: undefined,
      swarmReady: false,
      containerName: "a",
    });

    expect(store.app("a")).toMatchObject({ id: "a" });
    expect(store.app("missing")).toBeUndefined();
  });

  it("lists the apps a saved config declares", async () => {
    const store = await createStore(dataDir, createRuntime());

    await mkdir(path.join(store.storePath, ".git"));
    await mkdir(path.join(store.storePath, "store", "delta-app"), { recursive: true });
    await writeFile(path.join(store.storePath, "store", "delta-app", "compose.yml"), "services: {}\n");
    await writeFile(path.join(store.storePath, "store", "delta-app", "compose.swarm.yml"), "services: {}\n");

    await store.saveConfig(
      "categories:\n  - name: extra\n    color: red\n    stacks: [delta-app]\nswarm: [delta-app]\n",
    );

    expect(store.declaredAppIds()).toEqual(new Set(["delta-app"]));
    expect(store.config.swarm()).toEqual(["delta-app"]);
    expect(store.app("delta-app")).toMatchObject({ swarmReady: true });
  });

  it("refuses to save a config the store contradicts, leaving the file untouched", async () => {
    const store = await createStore(dataDir, createRuntime());
    const file = path.join(store.storePath, "config", "hangar.yml");

    await mkdir(path.join(store.appsPath, "delta-app"), { recursive: true });
    await writeFile(path.join(store.appsPath, "delta-app", "compose.yml"), "services: {}\n");

    const source = [
      "categories:",
      "  - { name: extra, color: red, stacks: [delta-app, ghost-app, { id: delta-app, run: false }] }",
      "  - { name: up, color: red, stacks: [{ id: delta-app, update: false }] }",
      "swarm: [delta-app]",
      "",
    ].join("\n");

    await expect(store.saveConfig(source)).rejects.toThrow(
      [
        "Invalid Hangar config:",
        "✖ ghost-app is not an app of the store: no store/ghost-app/compose.yml",
        "✖ delta-app is declared twice, in extra and extra",
        "✖ The category up is named like a CLI command",
        "✖ delta-app is declared twice, in extra and up",
        "✖ delta-app is listed under swarm but has no compose.swarm.yml",
      ].join("\n"),
    );

    expect(await readFile(file, "utf8")).toBe(CATEGORIES);
  });

  it("loads a config the store contradicts, warning about each problem instead of refusing it", async () => {
    const store = await createStore(dataDir, createRuntime());
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    await writeFile(
      path.join(store.storePath, "config", "hangar.yml"),
      "categories:\n  - { name: extra, color: red, stacks: [ghost-app] }\n",
    );

    await store.loadConfig();

    expect(store.config.entries().map(entry => entry.id)).toEqual(["ghost-app"]);
    expect(warn).toHaveBeenCalledWith(
      "hangar.yml: ghost-app is not an app of the store: no store/ghost-app/compose.yml",
    );

    warn.mockRestore();
  });

  it("checks a saved config against the folders that are apps, and only those", async () => {
    const store = await createStore(dataDir, createRuntime());

    await mkdir(path.join(store.appsPath, "notes"), { recursive: true });
    await mkdir(path.join(store.appsPath, "MyApp"), { recursive: true });
    await mkdir(path.join(store.appsPath, "blank-app"), { recursive: true });
    await writeFile(path.join(store.appsPath, "networks.yml"), "networks: {}\n");
    await writeFile(path.join(store.appsPath, "MyApp", "compose.yml"), "services: {}\n");
    // An empty compose file still makes an app, as the commands take it.
    await writeFile(path.join(store.appsPath, "blank-app", "compose.yml"), "");

    const source = "categories:\n  - { name: lab, color: red, stacks: [notes, networks.yml, MyApp, blank-app] }\n";

    await expect(store.saveConfig(source)).rejects.toThrow(
      [
        "✖ notes is not an app of the store: no store/notes/compose.yml",
        "✖ networks.yml is not an app of the store: no store/networks.yml/compose.yml",
        // Not a valid id: the store never lists it, so the config may not name it either.
        "✖ MyApp is not an app of the store: no store/MyApp/compose.yml",
      ].join("\n"),
    );
  });

  it("reports a contradicted config once when asked, not on every refresh, the shared list included", async () => {
    const store = await createStore(dataDir, createRuntime());
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    await mkdir(path.join(store.storePath, ".git"), { recursive: true });
    await writeFile(
      path.join(store.storePath, "config", "hangar.yml"),
      "categories:\n  - { name: extra, color: red, stacks: [ghost-app] }\nshared: [networks.yml]\n",
    );

    await store.refresh();
    expect(warn).not.toHaveBeenCalled();

    await store.checkConfig();
    expect(warn).toHaveBeenCalledWith(
      "hangar.yml: ghost-app is not an app of the store: no store/ghost-app/compose.yml",
    );

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("shared is no longer read"));
    warn.mockRestore();
  });

  describe("createApp", () => {
    const COMPOSE = "name: Delta\nservices:\n  delta-app:\n    image: nginx\n";

    it("adds a new app once docker compose accepts it", async () => {
      const runtime = createRuntime();
      const store = await createStore(dataDir, runtime);

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

    it("refuses ids that escape the store, a shared file's name and creating an existing app", async () => {
      const store = await createStore(dataDir, createRuntime());

      await mkdir(path.join(store.storePath, "store", "delta-app"), { recursive: true });
      await writeFile(path.join(store.storePath, "store", "networks.yml"), "networks: {}\n");

      await expect(store.createApp("../config", COMPOSE)).rejects.toThrow(/Invalid app id/);
      await expect(store.createApp("networks.yml", COMPOSE)).rejects.toThrow(/already exists/);
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

    it("refuses the files of a shared file, of a folder with no compose file, or of a missing app", async () => {
      const { store } = await withApp();

      await writeFile(path.join(store.appsPath, "networks.yml"), "networks: {}\n");
      await mkdir(path.join(store.appsPath, "docs"), { recursive: true });

      await expect(store.files("networks.yml")).rejects.toThrow(/does not exist/);
      await expect(store.files("docs")).rejects.toThrow(/does not exist/);
      await expect(store.files("other-app")).rejects.toThrow(/does not exist/);
    });
  });
});

describe("HangarStore.compose", () => {
  let dataDir: string;

  /** Apps of the store: a folder in the clone with a compose file. */
  const withStacks = async (...stacks: string[]) => {
    const runtime = createRuntime();
    const store = await createStore(dataDir, runtime);

    await Promise.all(
      stacks.map(async stack => {
        await mkdir(path.join(store.appsPath, stack), { recursive: true });
        await writeFile(path.join(store.appsPath, stack, "compose.yml"), "services: {}\n");
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
        path.join(store.appsPath, "alpha-app", "compose.yml"),
        "up",
        "-d",
      ],
      undefined,
    );
  });

  it("pins the project name to the stack, not the compose file's display name", async () => {
    const { store, runtime } = await withStacks("alpha-app");

    await writeFile(path.join(store.appsPath, "alpha-app", "compose.yml"), "name: Alpha App\nservices: {}\n");

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
        path.join(store.appsPath, "alpha-app", "compose.yml"),
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

  it("rejects a name that is no app of the store, and runs any app that is, declared or not", async () => {
    const { store, runtime } = await withStacks("alpha-app", "solo-app");

    await expect(store.compose("missing-app", ["logs"])).rejects.toThrow("Unknown app or category: missing-app");
    await expect(store.compose("../config", ["logs"])).rejects.toThrow("Unknown app or category: ../config");
    // A shared fragment sits in store/ too, but holds no compose file.
    await writeFile(path.join(store.appsPath, "networks.yml"), "networks: {}\n");
    await expect(store.compose("networks.yml", ["logs"])).rejects.toThrow("Unknown app or category: networks.yml");
    expect(runtime.run).not.toHaveBeenCalled();

    // In no category: the clone is all an app needs to run.
    await store.compose("solo-app", ["up", "-d"]);
    expect(targets(runtime)).toEqual(["solo-app"]);
  });

  /** A store declaring `hangar.yml` as given, with these apps in its clone. */
  const withConfig = async (config: string, ...stacks: string[]) => {
    const fixture = await withStacks(...stacks);

    await writeFile(path.join(fixture.store.storePath, "config", "hangar.yml"), config);
    await fixture.store.config.load();

    return fixture;
  };

  /** Infrastructure starts by itself; in the lab, llama-cpp only when asked. */
  const OPTIONS = `
categories:
  - name: infra
    color: blue
    stacks: [traefik, { id: arcane, update: false }]
  - name: lab
    color: amber
    stacks: [{ id: llama-cpp, run: false }, miniflux]
`;

  it("leaves the run: false apps out of a whole-store up and pull, but not out of down", async () => {
    const { store, runtime } = await withConfig(OPTIONS, "traefik", "arcane", "llama-cpp", "miniflux");

    await store.compose("up", ["-d"]);
    expect(targets(runtime)).toEqual(["traefik", "arcane", "miniflux"]);

    runtime.run.mockClear();
    // pull runs in parallel: only the set of apps is fixed, not the order of the calls.
    await store.compose("pull", []);
    expect(targets(runtime).sort()).toEqual(["arcane", "miniflux", "traefik"]);

    runtime.run.mockClear();
    // Before host maintenance: an app started by hand must not survive a whole-store down.
    await store.compose("down", []);
    expect(targets(runtime)).toEqual(["miniflux", "llama-cpp", "arcane", "traefik"]);
  });

  it("covers the run: false apps of a category named explicitly, and an app named directly", async () => {
    const { store, runtime } = await withConfig(OPTIONS, "traefik", "arcane", "llama-cpp", "miniflux");

    await store.compose("lab", ["up", "-d"]);
    await store.compose("llama-cpp", ["up", "-d"]);

    expect(targets(runtime)).toEqual(["llama-cpp", "miniflux", "llama-cpp"]);
  });

  it("keeps an app that ships a compose.swarm.yml in the compose groups: compose and swarm are independent", async () => {
    const { store, runtime } = await withConfig(OPTIONS, "traefik", "arcane", "llama-cpp", "miniflux");

    await writeFile(path.join(store.appsPath, "miniflux", "compose.swarm.yml"), "services: {}\n");
    await store.compose("lab", ["down"]);

    expect(targets(runtime)).toEqual(["miniflux", "llama-cpp"]);
  });

  it("does nothing on a category with nothing to run, rather than taking it for an app id", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    const { store, runtime } = await withConfig(
      "categories:\n  - { name: empty, color: blue, stacks: [] }\n  - { name: gone, color: blue, stacks: [ghost-app] }\n",
    );

    await expect(store.compose("empty", ["up", "-d"])).resolves.toBeUndefined();
    await expect(store.compose("gone", ["up", "-d"])).resolves.toBeUndefined();
    expect(runtime.run).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips, in a group, the entries compose could not run: no app behind the id, or no valid project name", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    const { store, runtime } = await withConfig(
      "categories:\n  - { name: lab, color: blue, stacks: [ghost-app, llama.cpp, alpha-app] }\n",
      "llama.cpp",
      "alpha-app",
    );

    await store.compose("up", ["-d"]);

    expect(targets(runtime)).toEqual(["alpha-app"]);
    expect(warn).toHaveBeenCalledWith("Skipping ghost-app: not an app of the store");
    expect(warn).toHaveBeenCalledWith("Skipping llama.cpp: compose rejects it as a project name");
    warn.mockRestore();
  });

  it("refuses an attached up on a category that covers several apps, but not on one app", async () => {
    const { store, runtime } = await withConfig(OPTIONS, "traefik", "arcane", "llama-cpp", "miniflux");

    await expect(store.compose("infra", ["up"])).rejects.toThrow("Non detached mode");
    await store.compose("llama-cpp", ["up"]);

    expect(targets(runtime)).toEqual(["llama-cpp"]);
  });

  it("runs one app as itself, even when a category or a whole-store word bears its name", async () => {
    const { store, runtime } = await withConfig(
      "categories:\n  - { name: alpha-app, color: blue, stacks: [beta-app, gamma-app] }\n",
      "alpha-app",
      "beta-app",
      "gamma-app",
      "up",
    );

    await store.composeApp("alpha-app", ["up", "-d"]);
    await store.composeApp("up", ["logs"]);

    // compose() would have read both names as groups: the category, then the whole store.
    expect(targets(runtime)).toEqual(["alpha-app", "up"]);
  });

  it("refuses to run one app compose rejects as a project name, with a reason", async () => {
    const { store, runtime } = await withStacks("llama.cpp");

    await expect(store.composeApp("llama.cpp", ["up", "-d"])).rejects.toThrow(
      "llama.cpp cannot run with compose: a project name takes lowercase letters, digits, - and _",
    );

    await expect(store.compose("llama.cpp", ["up", "-d"])).rejects.toThrow("llama.cpp cannot run with compose");
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

describe("HangarStore in the swarm", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "hangar-stack-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  /** The categories group the compose apps; the swarm list, independent of them, names solo-app too. */
  const SWARM_CATEGORIES = `
categories:
  - name: essentials
    color: blue
    stacks: [alpha-app, beta-app]
  - name: utilities
    color: green
    stacks: [gamma-app, { id: delta-app, run: false }]
swarm: [gamma-app, solo-app, alpha-app]
`;

  /** Apps of the store; the swarm-ready ones get a compose.swarm.yml. */
  const withApps = async ({ ready }: { ready: string[] }) => {
    const runtime = createRuntime();
    const store = await createStore(dataDir, runtime);

    await writeFile(path.join(store.storePath, "config", "hangar.yml"), SWARM_CATEGORIES);
    await writeFile(path.join(store.dataPath, ".env.global"), "DOMAIN=home.lan\n");
    await store.config.load();
    await Promise.all(
      ["alpha-app", "beta-app", "gamma-app", "delta-app", "solo-app"].map(async app => {
        await mkdir(path.join(store.appsPath, app), { recursive: true });
        await writeFile(path.join(store.appsPath, app, "compose.yml"), "services: {}\n");

        if (ready.includes(app)) {
          await writeFile(path.join(store.appsPath, app, "compose.swarm.yml"), "services: {}\n");
        }
      }),
    );

    return { store, runtime };
  };

  /** The `-p` project each `docker compose` call targeted. */
  const projects = (runtime: ReturnType<typeof createRuntime>) =>
    runtime.run.mock.calls.map(([, args]) => args[args.indexOf("-p") + 1]);

  it("runs a swarm-ready app with compose too: an app may run both ways", async () => {
    const { store, runtime } = await withApps({ ready: ["beta-app"] });

    await store.compose("essentials", ["up", "-d"]);
    await store.compose("beta-app", ["restart"]);

    expect(projects(runtime)).toEqual(["alpha-app", "beta-app", "beta-app"]);
  });

  /** The `docker` calls made, as `compose down` or `stack deploy`. */
  const dockerCalls = (runtime: ReturnType<typeof createRuntime>) =>
    runtime.run.mock.calls.map(([, args]) => (args[0] === "stack" ? `stack ${args[1]}` : `compose ${args.at(-1)}`));

  it("deploys an app's stack, leaving its compose project and hangar.yml alone", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app"] });
    const config = path.join(store.storePath, "config", "hangar.yml");
    const before = await readFile(config, "utf8");

    await store.deployToSwarm("alpha-app");

    expect(dockerCalls(runtime)).toEqual(["stack deploy"]);
    expect(await readFile(config, "utf8")).toBe(before);
  });

  it("takes an empty compose.swarm.yml for none: the app cannot run in the swarm yet", async () => {
    const { store, runtime } = await withApps({ ready: [] });

    await writeFile(path.join(store.appsPath, "alpha-app", "compose.swarm.yml"), "");

    await expect(store.deployToSwarm("alpha-app")).rejects.toThrow("alpha-app is not a swarm app");
    expect(runtime.run).not.toHaveBeenCalled();
  });

  /** The stack each call named: its last argument, which `deploy`, `rm` and `ps` end with. */
  const stacks = (runtime: ReturnType<typeof createRuntime>) => runtime.run.mock.calls.map(([, args]) => args.at(-1));

  it("deploys an app from its two files, with .env.global in the environment", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app"] });
    const folder = path.join(store.appsPath, "alpha-app");

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
    const { store, runtime } = await withApps({ ready: ["alpha-app"] });
    const folder = path.join(store.appsPath, "alpha-app");
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

  it("deploys the swarm list in its order, and removes it backwards", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app", "beta-app", "gamma-app", "solo-app"] });

    await store.stack("deploy", []);

    // beta-app ships a compose.swarm.yml but is not listed: the categories say nothing about the swarm.
    expect(stacks(runtime)).toEqual(["gamma-app", "solo-app", "alpha-app"]);

    runtime.run.mockClear();
    await store.stack("rm", []);

    expect(stacks(runtime)).toEqual(["alpha-app", "solo-app", "gamma-app"]);
  });

  it("refuses a category: categories group the compose apps", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app", "beta-app"] });

    await expect(store.stack("essentials", ["deploy"])).rejects.toThrow(
      "essentials is a category: categories group the compose apps",
    );

    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("does nothing when the swarm list is empty", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app"] });

    await writeFile(path.join(store.storePath, "config", "hangar.yml"), "categories: []\n");
    await store.config.load();

    await expect(store.stack("deploy", [])).resolves.toBeUndefined();
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("manages an app named directly, as a stack deployed by hand", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app"] });

    await store.stack("alpha-app", ["rm"]);

    expect(stacks(runtime)).toEqual(["alpha-app"]);
  });

  it("skips, with a warning, a listed app without compose.swarm.yml, and refuses it by name", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const { store, runtime } = await withApps({ ready: ["gamma-app", "solo-app"] });

    await store.stack("deploy", []);

    expect(stacks(runtime)).toEqual(["gamma-app", "solo-app"]);
    expect(warn).toHaveBeenCalledWith("Skipping alpha-app: it has no compose.swarm.yml");
    await expect(store.stack("alpha-app", ["deploy"])).rejects.toThrow("alpha-app is not a swarm app");
    warn.mockRestore();
  });

  it("deploys an app hangar.yml declares nowhere: the file only drives the commands over lists", async () => {
    const { store, runtime } = await withApps({ ready: ["delta-app"] });

    await writeFile(path.join(store.storePath, "config", "hangar.yml"), "categories: []\n");
    await store.config.load();

    await store.stack("delta-app", ["deploy"]);
    await store.compose("delta-app", ["up", "-d"]);

    expect(runtime.run.mock.calls.map(([, args]) => args.slice(0, 2).join(" "))).toEqual([
      "stack deploy",
      "compose --env-file",
    ]);
  });

  it("deploys one app as itself, even one named like a whole-list verb", async () => {
    const { store, runtime } = await withApps({ ready: ["gamma-app"] });

    await mkdir(path.join(store.appsPath, "deploy"), { recursive: true });
    await writeFile(path.join(store.appsPath, "deploy", "compose.yml"), "services: {}\n");
    await writeFile(path.join(store.appsPath, "deploy", "compose.swarm.yml"), "services: {}\n");

    await store.stackApp("deploy", ["rm"]);

    // stack("deploy", ["rm"]) would have taken the whole swarm list down.
    expect(stacks(runtime)).toEqual(["deploy"]);
  });

  it("leaves out of the swarm list an id that is no folder name, before reading anything", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const { store, runtime } = await withApps({ ready: ["gamma-app"] });

    await writeFile(
      path.join(store.storePath, "config", "hangar.yml"),
      "categories: []\nswarm: [../outside, gamma-app]\n",
    );

    await store.config.load();
    await store.stack("deploy", []);

    expect(stacks(runtime)).toEqual(["gamma-app"]);
    warn.mockRestore();
  });

  it("refuses an unknown name, an app without compose.swarm.yml, and an unknown verb", async () => {
    const { store, runtime } = await withApps({ ready: ["alpha-app"] });

    await expect(store.stack("ghost-app", ["deploy"])).rejects.toThrow("Unknown app or category: ghost-app");
    await expect(store.stack("beta-app", ["deploy"])).rejects.toThrow("beta-app is not a swarm app");
    await expect(store.stack("alpha-app", ["scale"])).rejects.toThrow("Unknown swarm command: scale");
    expect(runtime.run).not.toHaveBeenCalled();
  });
});
