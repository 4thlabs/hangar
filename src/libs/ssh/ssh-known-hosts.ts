import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The host keys Hangar trusts, one line per `host:port` with its fingerprint, as `ssh` does on first
 * contact: the first key an address presents is recorded, and a different one later is refused. Deleting
 * the line trusts the next key again, after a reinstall of the host for instance.
 *
 * No `server-only` guard: see AGENTS.md § server-only.
 */
export class SshKnownHosts {
  readonly file: string;

  /** Chains the checks, so two first connections cannot both record a key. */
  private pending: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  /**
   * Whether `key` is the one `address` presented first; the first one is trusted, and recorded.
   * @param key The host's public key, in SSH wire format, as `ssh2` hands it to its `hostVerifier`
   */
  verify(address: string, key: Buffer): Promise<boolean> {
    const verified = this.pending.then(() => this.check(address, SshKnownHosts.fingerprint(key)));

    this.pending = verified.catch(() => undefined);

    return verified;
  }

  /** The fingerprint recorded for `address`, or `null` before its first connection. */
  async recorded(address: string): Promise<string | null> {
    const lines = await this.read();

    return lines.get(address) ?? null;
  }

  /** A key's fingerprint as `ssh-keygen -l` prints it: `SHA256:` and the unpadded base64 digest. */
  static fingerprint(key: Buffer): string {
    const digest = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");

    return `SHA256:${digest}`;
  }

  private async check(address: string, fingerprint: string): Promise<boolean> {
    const known = await this.recorded(address);

    if (known !== null) {
      return known === fingerprint;
    }

    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await appendFile(this.file, `${address} ${fingerprint}\n`, { mode: 0o600 });

    return true;
  }

  /** Every address recorded, with its fingerprint; none before the first connection. */
  private async read(): Promise<Map<string, string>> {
    let source: string;

    try {
      source = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new Map();
      }

      throw error;
    }

    const entries = source
      .split("\n")
      .map(line => line.trim().split(/\s+/))
      .filter((fields): fields is [string, string] => fields.length === 2);

    return new Map(entries);
  }
}
