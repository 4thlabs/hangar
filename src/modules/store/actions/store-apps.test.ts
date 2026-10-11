import { mkdtempSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
const { deployToSwarm, startApp, unfilledVariables } = await import("#modules/store/actions/store-apps.ts");

const CONFIG = "# The store\ncategories:\n  - name: Web\n    color: blue\n    stacks: [whoami, plain]\n";

/** The `docker` calls made so far, as `compose up` or `stack deploy` style strings. */
const dockerCalls = () =>
  vi.mocked(hangar.runtime.run).mock.calls.map(([, args]) => {
    const isStack = args[0] === "stack";

    return isStack ? `stack ${args[1]}` : `compose ${args.slice(args.indexOf("-f") + 2).join(" ")}`;
  });

const app = (id: string) => path.join(hangar.store.storePath, "store", id);
const envFile = () => path.join(mocks.dataDir, ".env.global");

beforeEach(async () => {
  await rm(mocks.dataDir, { recursive: true, force: true });
  await mkdir(path.join(hangar.store.storePath, ".git"), { recursive: true });
  await mkdir(path.join(hangar.store.storePath, "config"), { recursive: true });
  await mkdir(app("whoami"), { recursive: true });
  await mkdir(app("plain"), { recursive: true });
  await mkdir(app("solo"), { recursive: true });
  await writeFile(path.join(hangar.store.storePath, "config", "hangar.yml"), CONFIG);
  await writeFile(
    path.join(app("whoami"), "compose.yml"),
    "x-hangar:\n  name: Who Am I\nservices:\n  whoami:\n    image: whoami:${WHOAMI_TAG}\n    environment:\n      TOKEN: ${WHOAMI_TOKEN}\n      DOMAIN: ${DOMAIN}\n",
  );

  await writeFile(path.join(app("whoami"), "compose.swarm.yml"), "services: {}\n");
  await writeFile(path.join(app("plain"), "compose.yml"), "services: {}\n");
  await writeFile(path.join(app("solo"), "compose.yml"), "services:\n  solo:\n    image: solo:${SOLO_TAG}\n");
  await hangar.store.refresh();

  vi.spyOn(hangar.runtime, "run").mockReset().mockResolvedValue({ code: 0, stdout: "" });
});

afterAll(async () => {
  await rm(mocks.dataDir, { recursive: true, force: true });
});

describe("unfilledVariables", () => {
  it("seeds the app's variables, then names those still empty, leaving the bare ones to the operator", async () => {
    await writeFile(envFile(), "WHOAMI_TAG=v1\n");

    const result = await unfilledVariables("whoami");

    // DOMAIN belongs to no app: it is the operator's, and not Hangar's to ask about.
    expect(result).toEqual({ success: true, value: ["WHOAMI_TOKEN"] });
    expect(await readFile(envFile(), "utf8")).toContain("WHOAMI_TOKEN=");
  });

  it("names nothing once every variable is filled", async () => {
    await writeFile(envFile(), "WHOAMI_TAG=v1\nWHOAMI_TOKEN=secret\n");

    expect(await unfilledVariables("whoami")).toEqual({ success: true, value: [] });
  });

  it("refuses an app the store does not carry", async () => {
    expect(await unfilledVariables("ghost")).toMatchObject({ success: false });
  });
});

describe("startApp", () => {
  it("starts an app with compose, detached, and seeds its variables first", async () => {
    const result = await startApp("whoami");

    expect(result).toMatchObject({ success: true, message: "Who Am I a été démarrée." });
    expect(dockerCalls()).toEqual(["compose up -d"]);
    expect(await readFile(envFile(), "utf8")).toContain("WHOAMI_TOKEN=");
  });

  it("starts an app in no category: the store is all it needs", async () => {
    const result = await startApp("solo");

    expect(result.success).toBe(true);
    expect(dockerCalls()).toEqual(["compose up -d"]);
    expect(await readFile(envFile(), "utf8")).toContain("SOLO_TAG=");
  });

  it("passes on Docker's reason when the start fails", async () => {
    vi.mocked(hangar.runtime.run).mockRejectedValue(new HangarRuntimeError(1, "port is already allocated"));

    const result = await startApp("plain");

    expect(result).toMatchObject({ success: false, message: "port is already allocated" });
  });

  it("refuses an app the store does not carry, running nothing", async () => {
    expect(await startApp("ghost")).toMatchObject({ success: false });
    expect(hangar.runtime.run).not.toHaveBeenCalled();
  });
});

describe("deployToSwarm", () => {
  it("deploys an app's stack, leaving its compose project and hangar.yml as they were", async () => {
    const config = path.join(hangar.store.storePath, "config", "hangar.yml");
    const result = await deployToSwarm("whoami");

    expect(result).toMatchObject({ success: true, message: "Who Am I est déployée sur le swarm." });
    expect(dockerCalls()).toEqual(["stack deploy"]);
    expect(await readFile(config, "utf8")).toBe(CONFIG);
  });

  it("writes nothing beside the clone but the variables: Hangar keeps no state of its own", async () => {
    await deployToSwarm("whoami");

    expect((await readdir(mocks.dataDir)).sort()).toEqual([".env.global", "app-store"]);
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
});
