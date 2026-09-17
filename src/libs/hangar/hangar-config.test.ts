import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
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
  });

  it("starts empty, before anything is loaded", () => {
    expect(new HangarConfig("/nowhere/hangar.yml").categories()).toEqual([]);
  });

  it("loads a store without a config as a store without categories", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hangar-config-"));

    const config = await new HangarConfig(path.join(dir, "hangar.yml")).load();

    expect(config.categories()).toEqual([]);
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
});
