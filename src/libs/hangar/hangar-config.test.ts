import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

    expect(config.categories()).toEqual([{ name: "infra", color: "blue", stacks: ["traefik", "backrest"] }]);
    expect(config.shared()).toEqual([]);
  });

  it("loads the files shared by every stack", async () => {
    const file = await configFile(`
categories: []
shared: [networks.yml]
`);

    const config = await new HangarConfig(file).load();

    expect(config.shared()).toEqual(["networks.yml"]);
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

    await expect(new HangarConfig(file).load()).rejects.toThrow(/widgets\.0/);
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

    await expect(new HangarConfig(file).load()).rejects.toThrow(/categories\.0\.color/);
  });

  it("writes a valid config and applies it", async () => {
    const file = await configFile("categories: []\n");
    const config = await new HangarConfig(file).load();
    const source = "categories:\n  - name: infra\n    color: blue\n    stacks: [traefik]\n";

    await config.write(source);

    expect(await readFile(file, "utf8")).toBe(source);
    expect(config.categories()).toEqual([{ name: "infra", color: "blue", stacks: ["traefik"] }]);
  });

  it("refuses an invalid config without touching the file", async () => {
    const file = await configFile("categories: []\n");
    const config = await new HangarConfig(file).load();

    await expect(config.write("categories: [")).rejects.toThrow(/Invalid YAML/);
    await expect(config.write("widgets: []\n")).rejects.toThrow(/categories/);
    expect(await readFile(file, "utf8")).toBe("categories: []\n");
  });
});
