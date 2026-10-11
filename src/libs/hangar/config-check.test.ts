import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigCheck } from "./config-check.ts";
import type { Category, StackEntry } from "./hangar-config.ts";
import { HangarStore } from "./hangar-store.ts";

/** A `stacks` entry with the schema's defaults, overridden by `options`. */
const entry = (id: string, options: Partial<StackEntry> = {}): StackEntry => ({
  id,
  run: true,
  update: true,
  ...options,
});

const category = (name: string, ...stacks: StackEntry[]): Category => ({ name, color: "blue", stacks });

describe("ConfigCheck", () => {
  let appsPath: string;
  let check: ConfigCheck;

  /** The apps of the store, as `HangarStore` would list them to the check. */
  let appIds: Set<string>;

  /** An app of the store, with a compose.swarm.yml when given one. */
  const storeApp = async (id: string, swarm?: string) => {
    await mkdir(path.join(appsPath, id), { recursive: true });
    await writeFile(path.join(appsPath, id, "compose.yml"), "services: {}\n");
    appIds.add(id);

    if (swarm !== undefined) {
      await writeFile(path.join(appsPath, id, "compose.swarm.yml"), swarm);
    }
  };

  beforeEach(async () => {
    appsPath = path.join(await mkdtemp(path.join(tmpdir(), "hangar-check-")), "store");
    await mkdir(appsPath, { recursive: true });
    check = new ConfigCheck(appsPath, HangarStore.CliWords);
    appIds = new Set();
  });

  afterEach(async () => {
    await rm(path.dirname(appsPath), { recursive: true, force: true });
  });

  it("finds nothing wrong with a config that matches the store", async () => {
    await Promise.all([storeApp("traefik"), storeApp("miniflux", "services: {}\n"), storeApp("llama.cpp")]);

    const problems = await check.problems(
      {
        categories: [
          category("Infrastructure", entry("traefik")),
          // An app may only ever run in the swarm: an id compose rejects is the commands' concern, not the file's.
          category("Home", entry("miniflux"), entry("llama.cpp", { run: false, update: false })),
        ],
        swarm: ["miniflux"],
      },
      appIds,
    );

    expect(problems).toEqual([]);
  });

  it("checks nothing when the config is empty, and every id when the store holds no app yet", async () => {
    expect(await check.problems({ categories: [], swarm: [] }, appIds)).toEqual([]);
    expect(await check.problems({ categories: [category("Home", entry("frigate"))], swarm: [] }, appIds)).toEqual([
      "frigate is not an app of the store: no store/frigate/compose.yml",
    ]);
  });

  it("reports an app declared twice, naming both categories", async () => {
    await storeApp("arcane");

    const problems = await check.problems(
      {
        categories: [category("Infrastructure", entry("arcane")), category("Home", entry("arcane", { run: false }))],
        swarm: [],
      },
      appIds,
    );

    expect(problems).toEqual(["arcane is declared twice, in Infrastructure and Home"]);
  });

  it("reports an id that is not one of the store's apps", async () => {
    const problems = await check.problems({ categories: [category("Home", entry("ghost"))], swarm: [] }, appIds);

    expect(problems).toEqual(["ghost is not an app of the store: no store/ghost/compose.yml"]);
  });

  it("reports a category the CLI could not address: named like a command or like an app", async () => {
    await storeApp("frigate");

    const problems = await check.problems(
      { categories: [category("up"), category("ls"), category("frigate"), category("deploy")], swarm: [] },
      appIds,
    );

    // `deploy` is free: `swarm` takes no category, and `store deploy` reaches it.
    expect(problems).toEqual([
      "The category up is named like a CLI command",
      "The category ls is named like a CLI command",
      "The category frigate is named like an app of the store",
    ]);
  });

  it("checks the swarm list: an app listed twice, an unknown id, an app without a compose.swarm.yml", async () => {
    await Promise.all([storeApp("miniflux", "services: {}\n"), storeApp("traefik"), storeApp("whoami", "  \n")]);

    const problems = await check.problems(
      {
        categories: [category("Infrastructure", entry("miniflux"))],
        swarm: ["miniflux", "ghost", "traefik", "whoami", "miniflux"],
      },
      appIds,
    );

    // miniflux may run both ways: a category and the swarm list are independent.
    expect(problems).toEqual([
      "ghost is not an app of the store: no store/ghost/compose.yml",
      "traefik is listed under swarm but has no compose.swarm.yml",
      "whoami is listed under swarm but has no compose.swarm.yml",
      "miniflux is listed twice under swarm",
    ]);
  });
});
