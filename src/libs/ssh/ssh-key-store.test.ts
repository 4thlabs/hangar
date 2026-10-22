import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ssh2 from "ssh2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SshKeyError, SshKeyStore } from "./ssh-key-store.ts";

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hangar-ssh-keys-"));
  file = path.join(directory, "ssh", "id_key");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("SshKeyStore.save", () => {
  it("keeps a private key readable by its owner only, and describes it", async () => {
    const { private: privateKey } = ssh2.utils.generateKeyPairSync("ed25519");
    const store = new SshKeyStore(file);

    const info = await store.save(privateKey);

    expect(info).toMatchObject({ encrypted: false, type: "ssh-ed25519" });
    expect(info.encrypted === false && info.fingerprint).toMatch(/^SHA256:/);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await expect(store.privateKey()).resolves.toBe(privateKey);
    await expect(store.info()).resolves.toEqual(info);
  });

  it("takes an encrypted key, whose passphrase the terminal asks for", async () => {
    const { private: privateKey } = ssh2.utils.generateKeyPairSync("ed25519", {
      passphrase: "phrase",
      cipher: "aes256-ctr",
      rounds: 16,
    });

    await expect(new SshKeyStore(file).save(privateKey)).resolves.toEqual({ encrypted: true });
  });

  it("refuses a public key or a file that holds no key, and keeps the key in place", async () => {
    const pair = ssh2.utils.generateKeyPairSync("ed25519");
    const store = new SshKeyStore(file);

    await store.save(pair.private);

    await expect(store.save(pair.public)).rejects.toBeInstanceOf(SshKeyError);
    await expect(store.save("not a key")).rejects.toBeInstanceOf(SshKeyError);
    await expect(store.save("x".repeat(SshKeyStore.MaxLength + 1))).rejects.toBeInstanceOf(SshKeyError);
    expect(await readFile(file, "utf8")).toBe(pair.private);
    expect(await readdir(path.dirname(file))).toEqual(["id_key"]);
  });
});

describe("SshKeyStore.remove", () => {
  it("forgets the key, and reads as none before one is imported", async () => {
    const store = new SshKeyStore(file);

    await expect(store.info()).resolves.toBeNull();
    await store.save(ssh2.utils.generateKeyPairSync("ed25519").private);
    await store.remove();

    await expect(store.privateKey()).resolves.toBeNull();
    await expect(store.remove()).resolves.toBeUndefined();
  });
});
