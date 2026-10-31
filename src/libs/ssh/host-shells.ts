import ssh2, { type Client, type ClientChannel } from "ssh2";
import { logger } from "#libs/logs";
import type { TerminalShell, TerminalSize } from "#libs/terminals";
import type { HostShellWords } from "./host-shell-words.ts";
import type { SshKeyStore } from "./ssh-key-store.ts";
import type { SshKnownHosts } from "./ssh-known-hosts.ts";
import { SshSignIn } from "./ssh-sign-in.ts";
import { SshTerminal } from "./ssh-terminal.ts";

/** The host a shell opens on, and the account it signs in to. */
export type SshTarget = { host: string; port: number; username: string };

/** What the host verifier saw, for the error that follows a rejection to say why. */
type HostCheck = { rejected: boolean; unreadable: boolean };

/** What a failed connection is told from: the host check, the sign-in, and the words to say it with. */
type FailedSignIn = { hostCheck: HostCheck; signIn: SshSignIn; words: HostShellWords };

/**
 * Interactive shells on the host, over SSH, handed to `TerminalSessions`. The terminal opens at once and
 * Hangar signs in from it, as `ssh` would: the imported key first, then the password, asked there. Each
 * shell has a connection of its own: ending it hangs up the shell and what it started.
 *
 * No `server-only` guard: see AGENTS.md § server-only.
 */
export class HostShells {
  /** The port `sshd` listens on unless told otherwise. */
  static readonly DefaultPort = 22;

  /** Long enough to type a password and a one-time code: ssh2's countdown runs while the questions wait. */
  private static readonly ReadyTimeoutMs = 3 * 60_000;

  /** Notices a host gone away, rather than leaving the session open until the client leaves. */
  private static readonly KeepaliveMs = 30_000;

  readonly target: SshTarget;

  private readonly keys: SshKeyStore;

  private readonly knownHosts: SshKnownHosts;

  private readonly createClient: () => Client;

  /**
   * @param keys The key Hangar signs in with, when the operator imported one
   * @param knownHosts The host keys Hangar trusts
   * @param createClient Makes the SSH client of each shell; injected so a test can hand a fake one
   */
  constructor(
    target: SshTarget,
    keys: SshKeyStore,
    knownHosts: SshKnownHosts,
    createClient: () => Client = () => new ssh2.Client(),
  ) {
    this.target = target;
    this.keys = keys;
    this.knownHosts = knownHosts;
    this.createClient = createClient;
  }

  /** `host:port`, as the known hosts record it. */
  get address(): string {
    return `${this.target.host}:${this.target.port}`;
  }

  /**
   * A terminal on the host, signing in while the client already reads it: a failure is said there, and ends it.
   * @param words What Hangar says in it, in the language of whoever opens it
   */
  async open(size: TerminalSize, words: HostShellWords): Promise<TerminalShell> {
    const terminal = new SshTerminal(size);
    const client = this.createClient();

    // Before connecting, and for the connection's whole life: ssh2 may emit a second error after the one
    // that fails the sign-in, and an `error` with no listener would bring the server down.
    client.on("error", error => logger.warn("An SSH connection failed", { error, host: this.address }));

    void this.login(terminal, client, words);

    return {
      stream: terminal.stream,
      target: { host: this.address, account: this.target.username },
      resize: async newSize => terminal.resize(newSize),
      end: async () => {
        client.end();
      },
    };
  }

  /** Signs in and hands the terminal to the shell, or says in it why not. */
  private async login(terminal: SshTerminal, client: Client, words: HostShellWords): Promise<void> {
    terminal.print(HostShells.dim(words.connecting({ account: `${this.target.username}@${this.address}` })));

    let privateKey: string | null;

    try {
      privateKey = await this.keys.privateKey();
    } catch (error) {
      logger.error("Could not read the imported SSH key", { error, file: this.keys.file });
      HostShells.fail(terminal, words.keyUnreadable({ file: this.keys.file }));

      return;
    }

    const account = { username: this.target.username, host: this.target.host, privateKey };
    const signIn = new SshSignIn(terminal, account, words);
    const failure = await this.connect(client, signIn, words);

    if (failure !== null) {
      HostShells.fail(terminal, failure);

      return;
    }

    try {
      terminal.attach(await HostShells.shell(client, terminal.size));
    } catch (error) {
      HostShells.fail(terminal, words.shellRefused({ reason: (error as Error).message }));
    }
  }

  /** Signs in. @returns why it failed, as the terminal says it, or `null` once signed in */
  private connect(client: Client, signIn: SshSignIn, words: HostShellWords): Promise<string | null> {
    const hostCheck: HostCheck = { rejected: false, unreadable: false };

    return new Promise(resolve => {
      client.once("ready", () => resolve(null));
      client.once("error", (error: Error & { level?: string }) =>
        resolve(this.failure(error, { hostCheck, signIn, words })),
      );

      // Without an error first, the session ended the connection: the client left, nobody reads anymore.
      client.once("close", () => resolve(words.closed));

      client.connect({
        ...this.target,
        authHandler: signIn.handler,
        readyTimeout: HostShells.ReadyTimeoutMs,
        keepaliveInterval: HostShells.KeepaliveMs,
        hostVerifier: (key: Buffer, verify: (trusted: boolean) => void) => {
          this.knownHosts.verify(this.address, key).then(
            trusted => {
              hostCheck.rejected = !trusted;
              verify(trusted);
            },
            (error: unknown) => {
              logger.error("Could not read the SSH known hosts", { error, file: this.knownHosts.file });
              hostCheck.unreadable = true;
              verify(false);
            },
          );
        },
      });
    });
  }

  /** What to say of a failed connection: each cause names its own fix. */
  private failure(error: Error & { level?: string }, { hostCheck, signIn, words }: FailedSignIn): string {
    const file = this.knownHosts.file;

    if (hostCheck.unreadable) {
      return words.knownHostsUnreadable({ file });
    }

    if (hostCheck.rejected) {
      return words.hostKeyChanged({ address: this.address, file });
    }

    if (signIn.cancelled) {
      return words.cancelled;
    }

    if (error.level === "client-authentication") {
      return words.accessDenied({ username: this.target.username });
    }

    return words.unreachable({ address: this.address, reason: HostShells.reason(error) });
  }

  /**
   * A connection error's own words. A host that resolves to several addresses, as `host.docker.internal`
   * does with IPv6 enabled, fails with an AggregateError whose message is empty: each attempt says why.
   */
  private static reason(error: Error): string {
    if (error instanceof AggregateError) {
      return error.errors.map((attempt: Error) => attempt.message).join(", ");
    }

    return error.message;
  }

  /** Says in red why the shell did not open, and ends the terminal. */
  private static fail(terminal: SshTerminal, message: string): void {
    terminal.print(`\x1b[31m${message}\x1b[0m\r\n`);
    terminal.finish();
  }

  private static dim(text: string): string {
    return `\x1b[2m${text}\x1b[0m\r\n`;
  }

  /** Opens the login shell, with a TTY of the client's size and the terminal type xterm emulates. */
  private static shell(client: Client, { cols, rows }: TerminalSize): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      client.shell({ term: "xterm-256color", cols, rows }, (error, channel) => {
        if (error) {
          reject(error);
        } else {
          resolve(channel);
        }
      });
    });
  }
}
