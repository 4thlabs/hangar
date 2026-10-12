import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
const { uninstallApp } = await import("#modules/store/actions/store-apps.ts");

const CONFIG = "# The store\ncategories:\n  - name: Web\n    color: blue\n    stacks: [whoami, ready]\n";

/** The `docker` calls made so far, as `compose down` or `stack deploy` style strings. */
const dockerCalls = () =>
  vi.mocked(hangar.runtime.run).mock.calls.map(([, args]) => {
    const isStack = args[0] === "stack";

    return isStack ? `stack ${args[1]}` : `compose ${args.at(-1)}`;
  });

describe("uninstallApp", () => {
  const app = (id: string) => path.join(hangar.store.storePath, "store", id);

  beforeEach(async () => {
    await rm(mocks.dataDir, { recursive: true, force: true });
    await mkdir(path.join(hangar.store.storePath, ".git"), { recursive: true });
    await mkdir(path.join(hangar.store.storePath, "config"), { recursive: true });
    await mkdir(hangar.store.installedPath, { recursive: true });
    await mkdir(app("whoami"), { recursive: true });
    await mkdir(app("ready"), { recursive: true });
    await writeFile(path.join(hangar.store.storePath, "config", "hangar.yml"), CONFIG);
    await writeFile(path.join(app("whoami"), "compose.yml"), "x-hangar:\n  name: Who Am I\nservices: {}\n");
    await writeFile(path.join(app("whoami"), "compose.swarm.yml"), "services: {}\n");
    await writeFile(path.join(app("ready"), "compose.yml"), "services: {}\n");
    await writeFile(path.join(app("ready"), "compose.swarm.yml"), "services: {}\n");
    await hangar.store.refresh();

    vi.spyOn(hangar.runtime, "run").mockReset().mockResolvedValue({ code: 0, stdout: "" });
    mocks.stacks = [];
  });

  afterAll(async () => {
    await rm(mocks.dataDir, { recursive: true, force: true });
  });

  it("takes both down on uninstall: the compose project, and the stack the swarm runs", async () => {
    mocks.stacks = [{ name: "ready" }];

    await hangar.store.link("ready");
    await hangar.store.refresh();

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

    await hangar.store.link("whoami");
    await hangar.store.refresh();
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
