import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HangarRuntimeError } from "#libs/hangar";

const mocks = vi.hoisted(() => ({
  dataDir: "",
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth/server", () => ({ sessions: { require: vi.fn(async () => ({ user: { id: "1" } })) } }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));
vi.mock("#libs/hangar/server", async () => {
  const { Hangar } = await import("#libs/hangar");

  mocks.dataDir = mkdtempSync(path.join(tmpdir(), "store-apps-"));

  return { hangar: Hangar.create("https://example.com/store.git", mocks.dataDir) };
});

const { hangar } = await import("#libs/hangar/server");
const { deployToSwarm, uninstallApp } = await import("#modules/store/actions/store-apps.ts");

const CONFIG = "# The store\ncategories:\n  - name: Web\n    color: blue\n    stacks: [whoami, plain]\n";

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
    await writeFile(path.join(hangar.store.storePath, "config", "hangar.yml"), CONFIG);
    await writeFile(path.join(app("whoami"), "compose.yml"), "x-hangar:\n  name: Who Am I\nservices: {}\n");
    await writeFile(path.join(app("whoami"), "compose.swarm.yml"), "services: {}\n");
    await writeFile(path.join(app("plain"), "compose.yml"), "services: {}\n");
    await hangar.store.refresh();

    vi.spyOn(hangar.runtime, "run").mockReset().mockResolvedValue({ code: 0, stdout: "" });
  });

  afterAll(async () => {
    await rm(mocks.dataDir, { recursive: true, force: true });
  });

  it("takes the compose app down, lists it under swarm:, then deploys its stack", async () => {
    const result = await deployToSwarm("whoami");

    expect(result).toMatchObject({ success: true, message: "Who Am I est déployée sur le swarm." });
    expect(dockerCalls()).toEqual(["compose -q", "compose down", "stack deploy"]);
    expect(hangar.store.app("whoami")).toMatchObject({ installed: true, runsInSwarm: true });
    expect(await readFile(path.join(hangar.store.storePath, "config", "hangar.yml"), "utf8")).toContain("# The store");
  });

  it("takes a freshly listed app back off swarm: when its deploy fails, with Docker's reason", async () => {
    vi.mocked(hangar.runtime.run).mockImplementation(async (_command, args) => {
      if (args[1] === "deploy") {
        throw new HangarRuntimeError(1, "this node is not a swarm manager");
      }

      return { code: 0, stdout: "" };
    });

    const result = await deployToSwarm("whoami");

    expect(result.success).toBe(false);
    expect(result.message).toContain("this node is not a swarm manager");
    expect(hangar.store.config.swarm()).toEqual([]);
  });

  it("refuses an app without compose.swarm.yml, running nothing", async () => {
    const result = await deployToSwarm("plain");

    expect(result.success).toBe(false);
    expect(hangar.runtime.run).not.toHaveBeenCalled();
  });

  it("removes a swarm app's stack on uninstall, never running compose down, and unlists it", async () => {
    await deployToSwarm("whoami");
    vi.mocked(hangar.runtime.run).mockClear();

    const result = await uninstallApp("whoami");

    expect(result).toMatchObject({ success: true, installed: false });
    expect(dockerCalls()).toEqual(["stack rm"]);
    expect(hangar.store.config.swarm()).toEqual([]);
  });

  it("uninstalls a swarm app on a node that can no longer remove its stack, saying what is left", async () => {
    await deployToSwarm("whoami");
    vi.mocked(hangar.runtime.run).mockRejectedValue(new HangarRuntimeError(1, "this node is not a swarm manager"));

    const result = await uninstallApp("whoami");

    expect(result).toMatchObject({ success: true, installed: false });
    expect(result.message).toContain("supprimez-la depuis un manager");
    expect(hangar.store.config.swarm()).toEqual([]);
  });
});
