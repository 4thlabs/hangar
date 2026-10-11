import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HangarRuntimeError } from "#libs/hangar";

const mocks = vi.hoisted(() => ({
  dataDir: "",
  /** What the swarm says it runs: a manager's view with these stacks. */
  stacks: [] as { name: string }[],
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth/server", () => ({ sessions: { require: vi.fn(async () => ({ user: { id: "1" } })) } }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));
vi.mock("#libs/docker/server", () => ({
  swarm: { cluster: async () => ({ state: "manager", stacks: mocks.stacks }) },
}));

vi.mock("#libs/hangar/server", async () => {
  const { Hangar } = await import("#libs/hangar");

  mocks.dataDir = mkdtempSync(path.join(tmpdir(), "store-apps-"));

  return { hangar: Hangar.create("https://example.com/store.git", mocks.dataDir) };
});

const { hangar } = await import("#libs/hangar/server");
const { deployToSwarm, uninstallApp } = await import("#modules/store/actions/store-apps.ts");

const CONFIG = "# The store\ncategories:\n  - name: Web\n    color: blue\n    stacks: [whoami, plain, ready]\n";

/** The `docker` calls made so far, as `compose down` or `stack deploy` style strings. */
const dockerCalls = () =>
  vi.mocked(hangar.runtime.run).mock.calls.map(([, args]) => {
    const isStack = args[0] === "stack";

    return isStack ? `stack ${args[1]}` : `compose ${args.at(-1)}`;
  });

describe("deployToSwarm", () => {
  const app = (id: string) => path.join(hangar.store.storePath, "store", id);

  beforeEach(async () => {
    await rm(mocks.dataDir, { recursive: true, force: true });
    await mkdir(path.join(hangar.store.storePath, ".git"), { recursive: true });
    await mkdir(path.join(hangar.store.storePath, "config"), { recursive: true });
    await mkdir(hangar.store.installedPath, { recursive: true });
    await mkdir(app("whoami"), { recursive: true });
    await mkdir(app("plain"), { recursive: true });
    await mkdir(app("ready"), { recursive: true });
    await writeFile(path.join(hangar.store.storePath, "config", "hangar.yml"), CONFIG);
    await writeFile(path.join(app("whoami"), "compose.yml"), "x-hangar:\n  name: Who Am I\nservices: {}\n");
    await writeFile(path.join(app("whoami"), "compose.swarm.yml"), "services: {}\n");
    await writeFile(path.join(app("plain"), "compose.yml"), "services: {}\n");
    await writeFile(path.join(app("ready"), "compose.yml"), "services: {}\n");
    await writeFile(path.join(app("ready"), "compose.swarm.yml"), "services: {}\n");
    await hangar.store.refresh();

    vi.spyOn(hangar.runtime, "run").mockReset().mockResolvedValue({ code: 0, stdout: "" });
    mocks.stacks = [];
  });

  afterAll(async () => {
    await rm(mocks.dataDir, { recursive: true, force: true });
  });

  it("deploys an app's stack, leaving its compose project and hangar.yml as they were", async () => {
    const config = path.join(hangar.store.storePath, "config", "hangar.yml");
    const result = await deployToSwarm("whoami");

    expect(result).toMatchObject({ success: true, message: "Who Am I est déployée sur le swarm." });
    expect(dockerCalls()).toEqual(["stack deploy"]);
    expect(await readFile(config, "utf8")).toBe(CONFIG);
  });

  it("passes on Docker's reason when the deploy fails", async () => {
    vi.mocked(hangar.runtime.run).mockRejectedValue(new HangarRuntimeError(1, "this node is not a swarm manager"));

    const result = await deployToSwarm("whoami");

    expect(result.success).toBe(false);
    expect(result.message).toContain("this node is not a swarm manager");
  });

  it("refuses an app without compose.swarm.yml, running nothing", async () => {
    const result = await deployToSwarm("plain");

    expect(result.success).toBe(false);
    expect(hangar.runtime.run).not.toHaveBeenCalled();
  });

  it("takes both down on uninstall: the compose project, and the stack the swarm runs", async () => {
    mocks.stacks = [{ name: "ready" }];

    await deployToSwarm("ready");
    vi.mocked(hangar.runtime.run).mockClear();

    const result = await uninstallApp("ready");

    expect(result).toMatchObject({ success: true, installed: false });
    expect(dockerCalls()).toEqual(["compose down", "stack rm"]);
  });

  it("leaves the swarm alone on uninstall when the app has no stack there", async () => {
    await hangar.store.link("ready");
    await hangar.store.refresh();

    const result = await uninstallApp("ready");

    expect(result).toMatchObject({ success: true, installed: false });
    expect(dockerCalls()).toEqual(["compose down"]);
  });

  it("says what is left when the stack cannot go on uninstall", async () => {
    mocks.stacks = [{ name: "whoami" }];

    await deployToSwarm("whoami");
    vi.mocked(hangar.runtime.run).mockImplementation(async (_command, args) => {
      if (args[0] === "stack") {
        throw new HangarRuntimeError(1, "this node is not a swarm manager");
      }

      return { code: 0, stdout: "" };
    });

    const result = await uninstallApp("whoami");

    expect(result).toMatchObject({ success: true, installed: false });
    expect(result.message).toContain("supprimez-la depuis un manager");
  });
});
