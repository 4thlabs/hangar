import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { parse } from "dotenv";
import { tmpdir } from "node:os";
import path from "node:path";
import { HangarEnv } from "./hangar-env.ts";

describe("HangarEnv", () => {
  let dir: string;
  let file: string;
  let installedPath: string;
  let env: HangarEnv;

  /** Installs an app, with the files compose interpolates: its compose and an optional app.env. */
  const stack = async (name: string, compose: string, appEnv?: string) => {
    await mkdir(path.join(installedPath, name), { recursive: true });
    await writeFile(path.join(installedPath, name, "compose.yml"), compose, "utf8");

    if (appEnv !== undefined) await writeFile(path.join(installedPath, name, "app.env"), appEnv, "utf8");
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "hangar-env-"));
    installedPath = path.join(dir, "app-installed");
    file = path.join(dir, ".env.global");
    await mkdir(installedPath, { recursive: true });
    env = new HangarEnv(dir, installedPath);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a file that does not exist yet as an empty environment", async () => {
    expect(await env.read()).toEqual({});
  });

  it("collects the variables the installed apps reference, and only those", async () => {
    await stack(
      "alpha-app",
      "services:\n  alpha:\n    image: alpha:${ALPHA_APP_TAG:-latest}\n    working_dir: ${PWD}\n    environment:\n      DOMAIN: $DOMAIN\n      PRICE: $$5\n",
    );
    await writeFile(path.join(installedPath, "networks.yml"), "networks:\n  web:\n    name: ${NETWORK}\n", "utf8");

    // PWD is compose's to fill, `$$5` is an escaped dollar, everything else is the operator's.
    expect(await env.required()).toEqual(["ALPHA_APP_TAG", "DOMAIN", "NETWORK"]);
  });

  it("reads the env_file targets beside a compose file", async () => {
    await stack(
      "alpha-app",
      "services:\n  alpha:\n    image: alpha\n    env_file: [./app.env]\n",
      "UPLOAD=${APP_PHOTO_DIR}/alpha\nTOKEN=${ALPHA_APP_TOKEN}\n",
    );

    expect(await env.required()).toEqual(["ALPHA_APP_TOKEN", "APP_PHOTO_DIR"]);
  });

  it("leaves the app's own configuration alone", async () => {
    await stack("alpha-app", "services:\n  alpha:\n    image: alpha:${ALPHA_APP_TAG}\n");
    // What glance and traefik keep under config/: the app expands these itself, compose never
    // reads them, so `${…}` in there asks nothing of the operator.
    await mkdir(path.join(installedPath, "alpha-app", "config", "widgets"), { recursive: true });
    await writeFile(
      path.join(installedPath, "alpha-app", "config", "widgets", "card.yml"),
      "url: ${ALPHA_APP_WIDGET_URL}\n",
      "utf8",
    );

    expect(await env.required()).toEqual(["ALPHA_APP_TAG"]);
  });

  it("asks for nothing when no app is installed yet", async () => {
    expect(await env.required()).toEqual([]);
  });

  it("ignores an app that sits in the store but was never installed", async () => {
    await stack("alpha-app", "services:\n  alpha:\n    image: alpha:${ALPHA_APP_TAG}\n");
    // Not linked into app-installed: the store carries it, this machine does not run it.
    await mkdir(path.join(dir, "app-store", "store", "beta-app"), { recursive: true });
    await writeFile(
      path.join(dir, "app-store", "store", "beta-app", "compose.yml"),
      "services:\n  beta:\n    image: beta:${BETA_APP_TAG}\n",
      "utf8",
    );

    await env.ensure();

    expect(await env.read()).toEqual({ ALPHA_APP_TAG: "" });
  });

  it("seeds the namespaced variables and leaves the bare ones to the operator", async () => {
    await stack(
      "alpha-app",
      "services:\n  alpha:\n    image: alpha\n    volumes: [${APP_DATA_DIR}/alpha:/data]\n    environment:\n      TZ: ${TZ}\n      DOMAIN: ${DOMAIN}\n      KEY: ${ALPHA_APP_KEY}\n",
    );

    await env.ensure();

    // TZ and DOMAIN belong to no app: they are the operator's to add, not Hangar's to guess.
    expect(await env.read()).toEqual({ ALPHA_APP_KEY: "", APP_DATA_DIR: "" });
  });

  it("never removes a bare variable the operator filled in by hand", async () => {
    await stack("alpha-app", "services:\n  alpha:\n    image: alpha\n    environment:\n      DOMAIN: ${DOMAIN}\n");
    await env.write({ DOMAIN: "example.com" });

    await env.ensure();

    expect(await env.read()).toEqual({ DOMAIN: "example.com" });
  });

  it("takes the prefix from the app name with the hyphens dropped as well as kept", async () => {
    await stack(
      "sync-in",
      "services:\n  sync-in:\n    image: sync-in\n    environment:\n      SECRET: ${SYNCIN_AUTH_SECRET}\n      PORT: ${SYNC_IN_PORT}\n",
    );

    await env.ensure();

    expect(await env.read()).toEqual({ SYNCIN_AUTH_SECRET: "", SYNC_IN_PORT: "" });
  });

  it("reads only the named app's files, and still accepts the neighbours it references", async () => {
    // What glance does: its own env file reaches for a key gluetun owns.
    await stack("alpha-app", "services:\n  alpha:\n    image: alpha\n", "GLUETUN=${GLUETUN_API_KEY}\n");
    await stack("gluetun", "services:\n  gluetun:\n    image: gluetun:${GLUETUN_TAG}\n");

    await env.ensure("alpha-app");

    // GLUETUN_API_KEY comes from alpha-app's own file; GLUETUN_TAG lives in a file never opened.
    expect(await env.read()).toEqual({ GLUETUN_API_KEY: "" });
  });

  it("creates the file with the keys the apps expect, left empty to fill", async () => {
    await stack(
      "alpha-app",
      "services:\n  alpha:\n    image: alpha\n    environment:\n      TAG: ${ALPHA_APP_TAG}\n      KEY: ${ALPHA_APP_KEY}\n",
    );

    await env.ensure();

    expect(await env.read()).toEqual({ ALPHA_APP_KEY: "", ALPHA_APP_TAG: "" });
  });

  it("pre-fills a new variable Hangar already knows the value of", async () => {
    env = new HangarEnv(dir, installedPath, { APP_DATA_DIR: "/srv/hangar/.data" });
    await stack(
      "alpha-app",
      "services:\n  alpha:\n    volumes: [${APP_DATA_DIR}/alpha:/data]\n    environment:\n      TAG: ${ALPHA_APP_TAG}\n",
    );

    await env.ensure();

    expect(await env.read()).toEqual({ ALPHA_APP_TAG: "", APP_DATA_DIR: "/srv/hangar/.data" });
  });

  it("never overwrites a value that is already filled in", async () => {
    await stack(
      "alpha-app",
      "services:\n  alpha:\n    image: alpha\n    environment:\n      TAG: ${ALPHA_APP_TAG}\n      KEY: ${ALPHA_APP_KEY}\n",
    );
    await env.write({ ALPHA_APP_TAG: "v1" });

    await env.ensure();

    expect(await env.read()).toEqual({ ALPHA_APP_KEY: "", ALPHA_APP_TAG: "v1" });
  });

  it("reads one variable, and treats a seeded-but-empty one as unset", async () => {
    await env.write({ DOMAIN: "example.com", ALPHA_APP_KEY: "" });

    expect(await env.get("DOMAIN")).toBe("example.com");
    expect(await env.get("ALPHA_APP_KEY")).toBeUndefined();
    expect(await env.get("NEVER_SET")).toBeUndefined();
  });

  it("serves a looked-up variable from memory, until a write changes it", async () => {
    await env.write({ DOMAIN: "example.com" });

    expect(await env.get("DOMAIN")).toBe("example.com");

    // Straight to disk, behind the cache's back: the lookup still answers from memory.
    await writeFile(file, "DOMAIN=stale.com\n", "utf8");

    expect(await env.get("DOMAIN")).toBe("example.com");

    await env.write({ TZ: "Europe/Paris" });

    expect(await env.get("DOMAIN")).toBe("stale.com");
  });

  it("answers a lookup with undefined when the file cannot be read, and recovers once it can", async () => {
    // A directory where the file belongs: readFile fails with EISDIR, which is not "not there yet".
    await mkdir(file);

    // A widget asking for a token gets "not set", not an exception that takes the page down.
    expect(await env.get("DOMAIN")).toBeUndefined();

    await rm(file, { recursive: true });
    await writeFile(file, "DOMAIN=example.com\n", "utf8");

    // The failure was never cached, so the fix is picked up without a write.
    expect(await env.get("DOMAIN")).toBe("example.com");
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
    // The stamp has millisecond resolution, so saves have to land in different ones to keep
    // their own copy. A human hitting save cannot do better; a loop can.
    const tick = () => new Promise(resolve => setTimeout(resolve, 2));

    await env.write({ DOMAIN: "example.com" });
    await tick();
    await env.write({ DOMAIN: "other.com" });
    await tick();
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
