import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { parse } from "dotenv";
import { tmpdir } from "node:os";
import path from "node:path";
import { HangarEnv } from "./hangar-env.ts";

describe("HangarEnv", () => {
  let dir: string;
  let file: string;
  let stacksPath: string;
  let env: HangarEnv;

  /** Writes a compose file for a stack, the only place the required variables come from. */
  const stack = async (name: string, compose: string) => {
    await mkdir(path.join(stacksPath, name), { recursive: true });
    await writeFile(path.join(stacksPath, name, "compose.yml"), compose, "utf8");
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "hangar-env-"));
    file = path.join(dir, ".env.global");
    stacksPath = path.join(dir, "store");
    env = new HangarEnv(file, stacksPath);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a file that does not exist yet as an empty environment", async () => {
    expect(await env.read()).toEqual({});
  });

  it("collects the variables the compose files reference, and only those", async () => {
    await stack(
      "alpha-app",
      "services:\n  alpha:\n    image: alpha:${ALPHA_TAG:-latest}\n    working_dir: ${PWD}\n    environment:\n      DOMAIN: $DOMAIN\n      PRICE: $$5\n",
    );
    await writeFile(path.join(stacksPath, "networks.yml"), "networks:\n  web:\n    name: ${NETWORK}\n", "utf8");

    // PWD is compose's to fill, `$$5` is an escaped dollar, everything else is the operator's.
    expect(await env.required()).toEqual(["ALPHA_TAG", "DOMAIN", "NETWORK"]);
  });

  it("asks for nothing when the store ships no stacks yet", async () => {
    expect(await env.required()).toEqual([]);
  });

  it("creates the file with the keys the stacks expect, left empty to fill", async () => {
    await stack(
      "alpha-app",
      "services:\n  alpha:\n    image: alpha\n    environment:\n      TZ: ${TZ}\n      DOMAIN: ${DOMAIN}\n",
    );

    await env.ensure();

    expect(await env.read()).toEqual({ DOMAIN: "", TZ: "" });
  });

  it("pre-fills a new variable Hangar already knows the value of", async () => {
    env = new HangarEnv(file, stacksPath, { APP_DATA_DIR: "/srv/hangar/.data" });
    await stack(
      "alpha-app",
      "services:\n  alpha:\n    volumes: [${APP_DATA_DIR}/alpha:/data]\n    environment:\n      TZ: ${TZ}\n",
    );

    await env.ensure();

    expect(await env.read()).toEqual({ APP_DATA_DIR: "/srv/hangar/.data", TZ: "" });
  });

  it("never overwrites a value that is already filled in", async () => {
    await stack(
      "alpha-app",
      "services:\n  alpha:\n    image: alpha\n    environment:\n      TZ: ${TZ}\n      DOMAIN: ${DOMAIN}\n",
    );
    await env.write({ TZ: "Europe/Paris" });

    await env.ensure();

    expect(await env.read()).toEqual({ DOMAIN: "", TZ: "Europe/Paris" });
  });

  it("keeps a variable added by hand since the caller last read the file", async () => {
    await env.write({ DOMAIN: "example.com" });

    // What a hand edit — or another tab — does between a render and its save.
    await writeFile(file, "DOMAIN=example.com\nHAND_WRITTEN=secret\n", "utf8");

    await env.write({ DOMAIN: "other.com" });

    expect(await env.read()).toEqual({ DOMAIN: "other.com", HAND_WRITTEN: "secret" });
  });

  it("drops only the variables it was explicitly told to drop", async () => {
    await env.write({ DOMAIN: "example.com", TZ: "Europe/Paris" });

    await env.write({}, ["TZ"]);

    expect(await env.read()).toEqual({ DOMAIN: "example.com" });
  });

  it("keeps one timestamped backup per rewrite", async () => {
    await env.write({ DOMAIN: "example.com" });
    await env.write({ DOMAIN: "other.com" });
    await env.write({ DOMAIN: "third.com" });

    // The first write had nothing to back up; the next two each kept the state they replaced.
    const backups = (await readdir(dir)).filter(entry => entry.endsWith(".bak")).sort();
    const contents = await Promise.all(
      backups.map(async backup => parse(await readFile(path.join(dir, backup), "utf8"))),
    );

    expect(backups).toHaveLength(2);
    expect(contents).toEqual([{ DOMAIN: "example.com" }, { DOMAIN: "other.com" }]);
  });

  it("writes a sorted, re-readable file", async () => {
    await env.write({ TZ: "Europe/Paris", ACME_EMAIL: "root@example.com" });

    const contents = await readFile(file, "utf8");

    expect(contents).toContain("# Global Environment Variables");
    expect(contents.match(/^[A-Z_]+=/gm)).toEqual(["ACME_EMAIL=", "TZ="]);
    expect(parse(contents)).toEqual({ ACME_EMAIL: "root@example.com", TZ: "Europe/Paris" });
  });
});
