import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import ssh2 from "ssh2";
import { HangarError } from "#libs/hangar";
import { SshKnownHosts } from "./ssh-known-hosts.ts";

/** What the page shows of the key Hangar signs in with: never the key itself. */
export type SshKeyInfo =
  | { encrypted: false; type: string; fingerprint: string }
  /** A passphrase hides even the key's type: it is asked for at each connection. */
  | { encrypted: true };

/** A file that holds no private key Hangar can sign in with. */
export class SshKeyError extends HangarError {
  constructor(reason: string) {
    super(`Not an SSH private key: ${reason}`);
    this.name = "SshKeyError";
  }
}

/**
 * The private key the operator gave Hangar to sign in to the host with, kept in its data directory
 * (`0600`). Read at each connection, so a key replaced or removed takes effect at once. Optional: without
 * it, the terminal signs in with the account's password.
 *
 * No `server-only` guard: see AGENTS.md § server-only.
 */
export class SshKeyStore {
  /** Far beyond a 16384-bit RSA key in PEM; bounds what an upload writes to disk. */
  static readonly MaxLength = 16 * 1_024;

  /** What ssh2 says of an OpenSSH key it cannot read without its passphrase. */
  private static readonly EncryptedMessage = /no passphrase given/;

  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  /** The key's type and fingerprint, or `null` when none was given. */
  async info(): Promise<SshKeyInfo | null> {
    const source = await this.privateKey();

    return source === null ? null : SshKeyStore.inspect(source);
  }

  /** The private key, or `null` when none was given. */
  async privateKey(): Promise<string | null> {
    try {
      return await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  /**
   * Replaces the key, once checked: a broken file never takes the place of a working key.
   * @throws {SshKeyError} if `source` holds no private key ssh2 can read
   */
  async save(source: string): Promise<SshKeyInfo> {
    const info = SshKeyStore.inspect(source);
    const partial = `${this.file}.partial`;

    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(partial, source, { mode: 0o600 });
    await rename(partial, this.file);

    return info;
  }

  /** Forgets the key: the terminal signs in with a password again. */
  async remove(): Promise<void> {
    await rm(this.file, { force: true });
  }

  /**
   * What a key is, without its passphrase.
   * @throws {SshKeyError} if `source` is too long, unreadable, or a public key
   */
  static inspect(source: string): SshKeyInfo {
    if (source.length > SshKeyStore.MaxLength) {
      throw new SshKeyError("too long");
    }

    const parsed = ssh2.utils.parseKey(source);

    if (parsed instanceof Error) {
      if (SshKeyStore.EncryptedMessage.test(parsed.message)) {
        return { encrypted: true };
      }

      throw new SshKeyError(parsed.message);
    }

    if (!parsed.isPrivateKey()) {
      throw new SshKeyError("a public key");
    }

    return { encrypted: false, type: parsed.type, fingerprint: SshKnownHosts.fingerprint(parsed.getPublicSSH()) };
  }
}
