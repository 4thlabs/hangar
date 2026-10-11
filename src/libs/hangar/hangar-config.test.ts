import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HangarConfig } from "./hangar-config.ts";

async function configFile(contents: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "hangar-config-"));
  const file = path.join(dir, "hangar.yml");

  await writeFile(file, contents, "utf8");

  return file;
}

describe("HangarConfig", () => {
  it("loads a valid config", async () => {
    const file = await configFile(`
categories:
  - name: infra
    color: blue
    stacks: [traefik, backrest]
`);

    const config = await new HangarConfig(file).load();

    expect(config.categories()).toEqual([
      {
        name: "infra",
        color: "blue",
        stacks: [
          { id: "traefik", run: true, update: true },
          { id: "backrest", run: true, update: true },
        ],
      },
    ]);
  });

  it("still loads a file listing shared files, and tells it does", async () => {
    const legacy = await new HangarConfig(await configFile("categories: []\nshared: [networks.yml]\n")).load();
    const current = await new HangarConfig(await configFile("categories: []\n")).load();

    expect(legacy.listsShared()).toBe(true);
    expect(current.listsShared()).toBe(false);
  });

  it("loads the swarm list in its order, empty when absent", async () => {
    const set = await new HangarConfig(await configFile("categories: []\nswarm: [miniflux, whoami]\n")).load();
    const unset = await new HangarConfig(await configFile("categories: []\n")).load();

    expect(set.swarm()).toEqual(["miniflux", "whoami"]);
    expect(unset.swarm()).toEqual([]);
  });

  it("loads the registry throttling, 100ms when absent", async () => {
    const set = await new HangarConfig(await configFile("categories: []\nregistryThrottling: 50\n")).load();
    const unset = await new HangarConfig(await configFile("categories: []\n")).load();

    expect(set.registryThrottling()).toBe(50);
    expect(unset.registryThrottling()).toBe(100);
  });

  it("starts empty, before anything is loaded", () => {
    expect(new HangarConfig("/nowhere/hangar.yml").categories()).toEqual([]);
  });

  it("loads a store without a config as a store without categories", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hangar-config-"));

    const config = await new HangarConfig(path.join(dir, "hangar.yml")).load();

    expect(config.categories()).toEqual([]);
  });

  it("loads the dashboard widgets the store declares", async () => {
    const file = await configFile(`
categories: []
widgets:
  - type: clock
    column: 1
  - type: github-releases
    column: 3
    repositories:
      - glanceapp/glance
      - immich-app/immich
`);

    const config = await new HangarConfig(file).load();

    expect(config.widgets()).toEqual([
      { type: "clock", column: 1 },
      { type: "github-releases", column: 3, repositories: ["glanceapp/glance", "immich-app/immich"] },
    ]);
  });

  it("falls back to the default dashboard when no widgets are declared", async () => {
    const file = await configFile("categories: []\n");

    const config = await new HangarConfig(file).load();

    expect(config.widgets().map(widget => widget.type)).toEqual(["clock", "docker-general-stats", "frigate-events"]);
  });

  it("rejects an unknown widget type, naming the entry", async () => {
    const file = await configFile(`
categories: []
widgets:
  - type: relases
    column: 3
`);

    await expect(new HangarConfig(file).load()).rejects.toThrow(/widgets\[0\]/);
  });

  it("rejects a config missing categories, naming the file", async () => {
    const file = await configFile("store: https://github.com/example/store.git\n");

    await expect(new HangarConfig(file).load()).rejects.toThrow(/Invalid Hangar config at .*hangar\.yml/);
  });

  it("rejects a malformed category instead of loading it", async () => {
    const file = await configFile(`
categories:
  - name: infra
    stacks: [traefik]
`);

    await expect(new HangarConfig(file).load()).rejects.toThrow(/categories\[0\]\.color/);
  });

  it("writes a valid config and applies it", async () => {
    const file = await configFile("categories: []\n");
    const config = await new HangarConfig(file).load();
    const source = "categories:\n  - name: infra\n    color: blue\n    stacks: [traefik]\n";

    await config.write(source);

    expect(await readFile(file, "utf8")).toBe(source);
    expect(config.entries()).toEqual([{ id: "traefik", run: true, update: true }]);
  });

  it("refuses an invalid config without touching the file", async () => {
    const file = await configFile("categories: []\n");
    const config = await new HangarConfig(file).load();

    await expect(config.write("categories: [")).rejects.toThrow(/Invalid YAML/);
    await expect(config.write("widgets: []\n")).rejects.toThrow(/categories/);
    expect(await readFile(file, "utf8")).toBe("categories: []\n");
  });

  it("reads a bare id and the long form with defaults as the same entry", async () => {
    const file = await configFile(`
categories:
  - name: infra
    color: blue
    stacks:
      - traefik
      - { id: arcane }
      - { id: miniflux, run: false, update: false }
`);

    const config = await new HangarConfig(file).load();

    expect(config.entries()).toEqual([
      { id: "traefik", run: true, update: true },
      { id: "arcane", run: true, update: true },
      { id: "miniflux", run: false, update: false },
    ]);
  });

  it("rejects a misspelled option instead of dropping it, naming the entry", async () => {
    const file = await configFile(`
categories:
  - name: infra
    color: blue
    stacks:
      - { id: arcane, upadte: false }
`);

    await expect(new HangarConfig(file).load()).rejects.toThrow(/upadte[\s\S]*categories\[0\]\.stacks\[0\]/);
  });

  it("rejects an entry without an id, and a run that is not a yes or no", async () => {
    const anonymous = await configFile("categories:\n  - { name: infra, color: blue, stacks: [{ run: false }] }\n");

    // Compose and swarm are independent: `run` only says whether `store up` starts the app, never where.
    const runtime = await configFile(
      "categories:\n  - { name: infra, color: blue, stacks: [{ id: arcane, run: swarm }] }\n",
    );

    await expect(new HangarConfig(anonymous).load()).rejects.toThrow(/stacks\[0\]\.id/);
    await expect(new HangarConfig(runtime).load()).rejects.toThrow(/stacks\[0\]\.run/);
  });

  it("lists the entries of every category or of one, in start order, an app declared twice keeping its first entry", async () => {
    const file = await configFile(`
categories:
  - name: infra
    color: blue
    stacks: [traefik, { id: arcane, update: false }]
  - name: home
    color: green
    stacks: [{ id: arcane, run: false }, frigate]
`);

    const config = await new HangarConfig(file).load();

    expect(config.entries().map(entry => entry.id)).toEqual(["traefik", "arcane", "frigate"]);
    expect(config.entries("home").map(entry => entry.id)).toEqual(["arcane", "frigate"]);
    expect(config.entries("nowhere")).toEqual([]);
    expect(config.entry("arcane")).toMatchObject({ update: false });
    expect(config.entry("undeclared")).toBeUndefined();
  });

  it("parses a config without applying it", async () => {
    const file = await configFile("categories: []\n");
    const config = await new HangarConfig(file).load();

    const parsed = config.parse("categories:\n  - { name: infra, color: blue, stacks: [traefik] }\n");

    expect(parsed.categories[0]?.stacks).toEqual([{ id: "traefik", run: true, update: true }]);

    expect(config.categories()).toEqual([]);
  });
});
