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
store: https://github.com/example/store.git
categories:
  - name: infra
    color: blue
    stacks: [traefik, backrest]
`);

    const config = await HangarConfig.create(file);

    expect(config.storeUrl()).toBe("https://github.com/example/store.git");
    expect(config.categories()).toEqual([{ name: "infra", color: "blue", stacks: ["traefik", "backrest"] }]);
  });

  it("rejects a config missing categories, naming the file", async () => {
    const file = await configFile("store: https://github.com/example/store.git\n");

    await expect(HangarConfig.create(file)).rejects.toThrow(/Invalid Hangar config at .*hangar\.yml/);
  });

  it("rejects a malformed category instead of loading it", async () => {
    const file = await configFile(`
store: https://github.com/example/store.git
categories:
  - name: infra
    stacks: [traefik]
`);

    await expect(HangarConfig.create(file)).rejects.toThrow(/categories\.0\.color/);
  });

  it("ships a valid config in the repo", async () => {
    const config = await HangarConfig.create("./config/hangar.yml");

    expect(config.storeUrl()).toMatch(/^https:\/\//);
    expect(config.categories().length).toBeGreaterThan(0);
  });
});
