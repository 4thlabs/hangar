import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HangarError, HangarRuntimeError } from "./hangar-error.ts";
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

const createRuntime = () =>
  ({
    run: vi.fn(async () => ({ code: 0, stdout: "" })),
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
        { id: "alpha-app", name: "Alpha App", icon: "alpha.svg", installed: true, containerName: "alpha-app" },
        { id: "beta-app", name: "Beta-app", icon: "beta.svg", installed: false, containerName: "beta-app" },
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
        { id: "good-app", name: "Good", icon: "good.svg", installed: false, containerName: "good-app" },
        {
          id: "no-metadata-app",
          name: "No Metadata",
          icon: undefined,
          installed: false,
          containerName: "no-metadata-app",
        },
      ]),
    );

    expect(store.apps).toHaveLength(2);
  });

  it("clears stale app metadata when the store is absent", async () => {
    const store = await createStore(dataDir, createRuntime());

    store.apps.add({ id: "old", name: "Old", icon: "old.svg", installed: true, containerName: "old" });

    await store.refresh();

    expect(store.apps).toHaveLength(0);
  });

  it("returns only installed app ids", async () => {
    const store = await createStore(dataDir, createRuntime());

    store.apps.add({ id: "a", name: "A", icon: undefined, installed: true, containerName: "a" });
    store.apps.add({ id: "b", name: "B", icon: undefined, installed: false, containerName: "b" });

    expect(store.installedProjectIds()).toEqual(new Set(["a"]));
  });

  it("looks up a store app by id", async () => {
    const store = await createStore(dataDir, createRuntime());

    store.apps.add({ id: "a", name: "A", icon: undefined, installed: true, containerName: "a" });

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

      expect(await store.appFile("delta-app", "compose.yml")).toBe(COMPOSE);
      expect(store.app("delta-app")?.name).toBe("Delta");
      expect(runtime.run).toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining([
          "config",
          "-q",
          path.join(store.storePath, "store", "delta-app", ".compose.pending.yml"),
        ]),
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

  describe("app files", () => {
    const COMPOSE = "name: Delta\nservices:\n  delta-app:\n    image: nginx\n";

    /** A store app on disk with a compose file, an env file, a nested config and the files the listing skips. */
    const withApp = async (runtime = createRuntime()) => {
      const store = await createStore(dataDir, runtime);
      const folder = path.join(store.storePath, "store", "delta-app");

      await mkdir(path.join(folder, "config"), { recursive: true });
      await mkdir(path.join(folder, ".cache"), { recursive: true });

      await Promise.all([
        writeFile(path.join(folder, "compose.yml"), COMPOSE),
        writeFile(path.join(folder, "delta.env"), "DELTA_PORT=8080\n"),
        writeFile(path.join(folder, "config", "settings.yml"), "theme: dark\n"),
        writeFile(path.join(folder, ".compose.pending.yml"), "services: {}\n"),
        writeFile(path.join(folder, ".cache", "state.json"), "{}"),
        writeFile(path.join(folder, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a])),
      ]);

      return { store, runtime, folder };
    };

    it("lists the text files of an app, nested ones by their relative path, without hidden or binary files", async () => {
      const { store, folder } = await withApp();

      await symlink(path.join(folder, "delta.env"), path.join(folder, "linked.env"));

      expect(await store.appFiles("delta-app")).toEqual(["compose.yml", "config/settings.yml", "delta.env"]);
    });

    it("reads a file of an app", async () => {
      const { store } = await withApp();

      expect(await store.appFile("delta-app", "config/settings.yml")).toBe("theme: dark\n");
      await expect(store.appFile("delta-app", "missing.yml")).rejects.toThrow(/has no file/);
      await expect(store.appFile("delta-app", "logo.png")).rejects.toThrow(/not a text file/);
    });

    it("writes the root compose.yml only once docker compose accepts it", async () => {
      const { store, runtime, folder } = await withApp();

      runtime.run.mockRejectedValueOnce(new HangarRuntimeError(1, "services must be a mapping"));

      await expect(store.writeAppFile("delta-app", "compose.yml", "services: 3\n")).rejects.toThrow(/mapping/);
      expect(await store.appFile("delta-app", "compose.yml")).toBe(COMPOSE);
      await expect(lstat(path.join(folder, ".compose.pending.yml"))).rejects.toThrow(/ENOENT/);

      await store.writeAppFile("delta-app", "compose.yml", "name: Renamed\nservices: {}\n");

      expect(await store.appFile("delta-app", "compose.yml")).toBe("name: Renamed\nservices: {}\n");
      expect(runtime.run).toHaveBeenCalledWith("docker", expect.arrayContaining(["config", "-q"]), { capture: true });
    });

    it("parses other YAML files instead of running docker compose", async () => {
      const { store, runtime } = await withApp();

      await expect(store.writeAppFile("delta-app", "config/settings.yml", "theme: [dark\n")).rejects.toThrow(
        /settings\.yml/,
      );

      expect(await store.appFile("delta-app", "config/settings.yml")).toBe("theme: dark\n");

      await store.writeAppFile("delta-app", "config/settings.yml", "theme: light\n");

      expect(await store.appFile("delta-app", "config/settings.yml")).toBe("theme: light\n");
      expect(runtime.run).not.toHaveBeenCalled();
    });

    it("rejects an env file with a line that declares no variable, quoted multi-line values aside", async () => {
      const { store } = await withApp();

      await expect(store.writeAppFile("delta-app", "delta.env", "DELTA_PORT=9090\nDELTA HOST\n")).rejects.toThrow(
        /delta\.env, line 2/,
      );

      expect(await store.appFile("delta-app", "delta.env")).toBe("DELTA_PORT=8080\n");

      const multiline = '# Ports\nDELTA_PORT=9090\n\nDELTA_KEY="-----BEGIN KEY-----\nabc\n-----END KEY-----"\n';

      await store.writeAppFile("delta-app", "delta.env", multiline);

      expect(await store.appFile("delta-app", "delta.env")).toBe(multiline);
    });

    it("writes any other file as is, creating it and its folders when missing", async () => {
      const { store, folder } = await withApp();

      await store.writeAppFile("delta-app", "config/nginx/site.conf", "server { listen 80 }\n");
      await store.writeAppFile("delta-app", "notes.txt", "");

      expect(await readFile(path.join(folder, "config", "nginx", "site.conf"), "utf8")).toBe("server { listen 80 }\n");
      expect(await store.appFiles("delta-app")).toContain("notes.txt");
    });

    it("skips what it cannot read, files too large to edit and folders too deep, and lists the rest", async () => {
      const { store, folder } = await withApp();
      const tooDeep = path.join(folder, "a", "b", "c", "d", "e", "f");

      await mkdir(path.join(folder, "locked"));
      await writeFile(path.join(folder, "locked", "hidden.yml"), "a: 1\n");
      await writeFile(path.join(folder, "large.log"), "x".repeat(1024 * 1024 + 1));
      await mkdir(tooDeep, { recursive: true });
      await writeFile(path.join(tooDeep, "deep.yml"), "a: 1\n");
      await writeFile(path.join(folder, "a", "b", "c", "d", "e", "shallow.yml"), "a: 1\n");
      await chmod(path.join(folder, "locked"), 0o000);

      try {
        expect(await store.appFiles("delta-app")).toEqual([
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
      const { store, folder } = await withApp();

      await writeFile(path.join(folder, "large.log"), "x".repeat(1024 * 1024 + 1));
      await writeFile(path.join(folder, "latin1.conf"), Buffer.from("caf\xe9\n", "latin1"));

      await expect(store.appFile("delta-app", "large.log")).rejects.toThrow(/too large/);
      await expect(store.appFile("delta-app", "latin1.conf")).rejects.toThrow(/not UTF-8/);
    });

    it("creates an empty file and its folders", async () => {
      const { store, folder } = await withApp();

      await store.createAppFile("delta-app", "config/nginx/site.conf");

      expect(await readFile(path.join(folder, "config", "nginx", "site.conf"), "utf8")).toBe("");
    });

    it("refuses to create a file over anything already there, binaries and symlinks included", async () => {
      const { store, folder } = await withApp();

      await symlink(path.join(folder, "delta.env"), path.join(folder, "linked.env"));

      await expect(store.createAppFile("delta-app", "logo.png")).rejects.toThrow(/logo\.png already exists/);
      await expect(store.createAppFile("delta-app", "linked.env")).rejects.toThrow(/linked\.env already exists/);
      await expect(store.createAppFile("delta-app", "delta.env")).rejects.toThrow(HangarError);
      expect((await readFile(path.join(folder, "logo.png"))).length).toBe(6);
      expect(await readFile(path.join(folder, "delta.env"), "utf8")).toBe("DELTA_PORT=8080\n");
    });

    it("validates the compose file with docker compose whatever path leads to it", async () => {
      const { store, runtime, folder } = await withApp();

      await symlink("compose.yml", path.join(folder, "alias.yml"));
      runtime.run.mockRejectedValueOnce(new HangarRuntimeError(1, "services must be a mapping"));

      await expect(store.writeAppFile("delta-app", "alias.yml", "services: 3\n")).rejects.toThrow(/mapping/);
      expect(await store.appFile("delta-app", "compose.yml")).toBe(COMPOSE);

      await store.writeAppFile("delta-app", "alias.yml", "name: Aliased\nservices: {}\n");

      expect(await store.appFile("delta-app", "compose.yml")).toBe("name: Aliased\nservices: {}\n");
      expect((await lstat(path.join(folder, "alias.yml"))).isSymbolicLink()).toBe(true);

      await store.writeAppFile("delta-app", "Compose.yml", "services: {}\n");

      expect(runtime.run).toHaveBeenCalledTimes(3);
      expect(runtime.run).toHaveBeenLastCalledWith("docker", expect.arrayContaining(["config", "-q"]), {
        capture: true,
      });
    });

    it("writes through a temporary file renamed onto the target, keeping its mode", async () => {
      const { store, folder } = await withApp();

      await chmod(path.join(folder, "delta.env"), 0o640);

      await store.writeAppFile("delta-app", "delta.env", "DELTA_PORT=9090\n");

      expect(await readFile(path.join(folder, "delta.env"), "utf8")).toBe("DELTA_PORT=9090\n");
      expect((await stat(path.join(folder, "delta.env"))).mode & 0o777).toBe(0o640);
      expect((await readdir(folder)).filter(name => name.endsWith(".tmp"))).toEqual([]);
    });

    it("refuses a path with a NUL byte or going through a file as invalid, not as a server failure", async () => {
      const { store } = await withApp();

      await expect(store.appFile("delta-app", "compose\0.yml")).rejects.toThrow(/Invalid file path/);
      await expect(store.writeAppFile("delta-app", "compose.yml/x.yml", "a: 1\n")).rejects.toThrow(
        /goes through a file/,
      );

      await expect(store.createAppFile("delta-app", "compose.yml/x.yml")).rejects.toThrow(HangarError);
    });

    it("refuses paths that climb out, are absolute or hidden, and folders taken for files", async () => {
      const { store } = await withApp();

      await expect(store.appFile("delta-app", "../alpha-app/compose.yml")).rejects.toThrow(/Invalid file path/);
      await expect(store.writeAppFile("delta-app", "config/../../x.yml", "")).rejects.toThrow(/Invalid file path/);
      await expect(store.writeAppFile("delta-app", "/etc/passwd", "")).rejects.toThrow(/Invalid file path/);
      await expect(store.writeAppFile("delta-app", ".compose.pending.yml", "")).rejects.toThrow(/Invalid file path/);
      await expect(store.writeAppFile("delta-app", "config", "")).rejects.toThrow(/not a file/);
    });

    it("refuses a symlink that leads out of the app folder, dangling or not", async () => {
      const { store, folder } = await withApp();
      const outside = path.join(dataDir, "outside");

      await mkdir(outside);
      await writeFile(path.join(outside, "secret.env"), "SECRET=1\n");
      await symlink(outside, path.join(folder, "escape"), "dir");
      await symlink(path.join(outside, "secret.env"), path.join(folder, "secret.env"));
      await symlink(path.join(outside, "created.yml"), path.join(folder, "dangling.yml"));

      await expect(store.appFile("delta-app", "escape/secret.env")).rejects.toThrow(/outside the app/);
      await expect(store.appFile("delta-app", "secret.env")).rejects.toThrow(/outside the app/);
      await expect(store.writeAppFile("delta-app", "escape/new.yml", "a: 1\n")).rejects.toThrow(/outside the app/);
      await expect(store.writeAppFile("delta-app", "dangling.yml", "a: 1\n")).rejects.toThrow(/broken symlink/);
      await expect(lstat(path.join(outside, "new.yml"))).rejects.toThrow(/ENOENT/);
      await expect(lstat(path.join(outside, "created.yml"))).rejects.toThrow(/ENOENT/);
    });

    it("refuses the files of a shared file or of a missing app", async () => {
      const { store } = await withApp();

      await expect(store.appFiles("networks.yml")).rejects.toThrow(/shared/);
      await expect(store.writeAppFile("other-app", "compose.yml", COMPOSE)).rejects.toThrow(/does not exist/);
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
