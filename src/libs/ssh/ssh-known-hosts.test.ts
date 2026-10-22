import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SshKnownHosts } from "./ssh-known-hosts.ts";

const HOST_KEY = Buffer.from("host key");
const OTHER_KEY = Buffer.from("another host key");

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hangar-known-hosts-"));
  file = path.join(directory, "ssh", "known_hosts");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("SshKnownHosts.verify", () => {
  it("trusts the first key an address presents, and records it", async () => {
    const knownHosts = new SshKnownHosts(file);

    await expect(knownHosts.verify("server.lan:22", HOST_KEY)).resolves.toBe(true);

    expect(await readFile(file, "utf8")).toBe(`server.lan:22 ${SshKnownHosts.fingerprint(HOST_KEY)}\n`);
  });

  it("trusts the same key again, and refuses another one", async () => {
    await new SshKnownHosts(file).verify("server.lan:22", HOST_KEY);
    const knownHosts = new SshKnownHosts(file);

    await expect(knownHosts.verify("server.lan:22", HOST_KEY)).resolves.toBe(true);
    await expect(knownHosts.verify("server.lan:22", OTHER_KEY)).resolves.toBe(false);
  });

  it("keeps one key per address", async () => {
    const knownHosts = new SshKnownHosts(file);

    await knownHosts.verify("server.lan:22", HOST_KEY);

    await expect(knownHosts.verify("server.lan:2222", OTHER_KEY)).resolves.toBe(true);
  });

  it("records only the first of two keys presented together", async () => {
    const knownHosts = new SshKnownHosts(file);

    const verdicts = await Promise.all([
      knownHosts.verify("server.lan:22", HOST_KEY),
      knownHosts.verify("server.lan:22", OTHER_KEY),
    ]);

    expect(verdicts).toEqual([true, false]);
  });
});

describe("SshKnownHosts fingerprints", () => {
  it("reads as ssh-keygen -l prints it", () => {
    const digest = createHash("sha256").update(HOST_KEY).digest("base64");

    expect(SshKnownHosts.fingerprint(HOST_KEY)).toBe(`SHA256:${digest.replace(/=+$/, "")}`);
  });

  it("is null for an address never reached", async () => {
    await expect(new SshKnownHosts(file).recorded("server.lan:22")).resolves.toBeNull();
  });
});
