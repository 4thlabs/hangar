import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ssh2, { type AnyAuthMethod, type AuthHandlerMiddleware, type Client, type ConnectConfig } from "ssh2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalShell } from "#libs/terminals";
import { TerminalMessages } from "#modules/terminal/messages.ts";
import { HostShells } from "./host-shells.ts";
import { SshKeyStore } from "./ssh-key-store.ts";
import { SshKnownHosts } from "./ssh-known-hosts.ts";

vi.mock("#libs/logs", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const TARGET = { host: "server.lan", port: 22, username: "thomas" };
const SIZE = { cols: 100, rows: 30 };
const HOST_KEY = Buffer.from("host key");
const PASSWORD = "secret";

/** What the fake host accepts. */
type HostPolicy = {
  methods: string[];
  /** The public key `authorized_keys` lists, in wire format. */
  authorizedKey?: Buffer;
  /** `false` for a host without PAM, which offers keyboard-interactive and refuses it without asking. */
  keyboardPrompts?: boolean;
};

/**
 * An SSH client running the handshake in memory: the host presents `hostKey`, then answers each method
 * `authHandler` picks as `policy` says, the way ssh2 drives it.
 */
class FakeClient extends EventEmitter {
  config: ConnectConfig | null = null;

  readonly tried: string[] = [];

  readonly channel = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    write: vi.fn(),
    setWindow: vi.fn(),
    close: vi.fn(),
  });

  readonly shell = vi.fn((_window: unknown, callback: (error: Error | undefined, channel: unknown) => void) => {
    callback(undefined, this.channel);
  });

  readonly end = vi.fn();

  hostKey = HOST_KEY;

  policy: HostPolicy = { methods: ["publickey", "password"] };

  /** Set to fail the connection before the handshake, as an unreachable host does. */
  socketError: Error | null = null;

  connect(config: ConnectConfig) {
    this.config = config;

    if (this.socketError) {
      const error = Object.assign(this.socketError, { level: "client-socket" });

      // ssh2 emits a second error for the same failure: the first listener must not be the last.
      setImmediate(() => {
        this.emit("error", error);
        this.emit("error", new Error("Connection lost before handshake"));
      });

      return this;
    }

    const verifier = config.hostVerifier as (key: Buffer, verify: (trusted: boolean) => void) => void;

    verifier(this.hostKey, trusted => {
      if (trusted) {
        this.authenticate(null);
      } else {
        this.emit("error", Object.assign(new Error("Host denied (verification failed)"), { level: "handshake" }));
      }
    });

    return this;
  }

  private authenticate(methodsLeft: string[] | null) {
    const handler = this.config!.authHandler as AuthHandlerMiddleware;

    handler(methodsLeft as never, false, method => void this.answer(method as AnyAuthMethod | false));
  }

  private async answer(method: AnyAuthMethod | false) {
    if (method === false) {
      this.emit(
        "error",
        Object.assign(new Error("All configured authentication methods failed"), {
          level: "client-authentication",
        }),
      );

      return;
    }

    this.tried.push(method.type);

    if (await this.accepts(method)) {
      this.emit("ready");
    } else {
      setImmediate(() => this.authenticate(this.policy.methods));
    }
  }

  private accepts(method: AnyAuthMethod): Promise<boolean> {
    switch (method.type) {
      case "publickey": {
        const key = method.key as ssh2.ParsedKey;

        return Promise.resolve(this.policy.authorizedKey?.equals(key.getPublicSSH()) ?? false);
      }

      case "password":
        return Promise.resolve(method.password === PASSWORD);
      case "keyboard-interactive":
        if (this.policy.keyboardPrompts === false) {
          return Promise.resolve(false);
        }

        return new Promise(resolve => {
          method.prompt("", "", "", [{ prompt: "Password: ", echo: false }], answers => {
            resolve(answers[0] === PASSWORD);
          });
        });
      default:
        return Promise.resolve(false);
    }
  }
}

/** The words of the French UI, which these tests read the terminal in. */
const WORDS = TerminalMessages.fr.shell;

let directory: string;
let client: FakeClient;

function hostShells() {
  return new HostShells(
    TARGET,
    new SshKeyStore(path.join(directory, "id_key")),
    new SshKnownHosts(path.join(directory, "known_hosts")),
    () => client as unknown as Client,
  );
}

/** Follows a terminal's output, to wait for what it shows next and to type into it. */
function screen(shell: TerminalShell) {
  let text = "";
  const waiters: (() => void)[] = [];
  let ended = false;

  shell.stream.on("data", (chunk: Buffer) => {
    text += chunk.toString();
    waiters.splice(0).forEach(wake => wake());
  });

  shell.stream.on("end", () => {
    ended = true;
    waiters.splice(0).forEach(wake => wake());
  });

  async function until(condition: () => boolean) {
    while (!condition()) {
      await new Promise<void>(resolve => waiters.push(resolve));
    }
  }

  return {
    get text() {
      return text;
    },
    shows: (expected: string) => until(() => text.includes(expected)),
    ends: () => until(() => ended),
    type: (input: string) => shell.stream.write(input),
  };
}

/** A key pair, its public half in wire format as `authorized_keys` lists it. */
function keyPair(options: { passphrase?: string } = {}) {
  const generated = options.passphrase
    ? ssh2.utils.generateKeyPairSync("ed25519", { passphrase: options.passphrase, cipher: "aes256-ctr", rounds: 16 })
    : ssh2.utils.generateKeyPairSync("ed25519");

  const publicKey = ssh2.utils.parseKey(generated.public) as ssh2.ParsedKey;

  return { privateKey: generated.private, publicKey: publicKey.getPublicSSH() };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hangar-host-shells-"));
  client = new FakeClient();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("HostShells sign-in with a password", () => {
  it("asks for the password in the terminal, then opens the login shell", async () => {
    const shell = await hostShells().open(SIZE, WORDS);
    const terminal = screen(shell);

    await terminal.shows("Mot de passe de thomas@server.lan : ");
    terminal.type(`${PASSWORD}\r`);
    await vi.waitFor(() => expect(client.shell).toHaveBeenCalled());

    expect(client.config).toMatchObject({ host: "server.lan", port: 22, username: "thomas" });
    expect(client.shell).toHaveBeenCalledWith({ term: "xterm-256color", cols: 100, rows: 30 }, expect.any(Function));
    expect(terminal.text).not.toContain(PASSWORD);
    expect(shell.target).toEqual({ host: "server.lan:22", account: "thomas" });
  });

  it("asks again after a wrong password, and gives up after three", async () => {
    const terminal = screen(await hostShells().open(SIZE, WORDS));

    for (const attempt of [1, 2, 3]) {
      await vi.waitFor(() => expect(terminal.text.split("Mot de passe de").length - 1).toBe(attempt));
      terminal.type("wrong\r");
    }

    await terminal.ends();
    expect(terminal.text.match(/Accès refusé, réessayez\./g)).toHaveLength(2);
    expect(terminal.text).toContain("Accès refusé pour thomas");
    expect(client.shell).not.toHaveBeenCalled();
  });

  it("goes through keyboard-interactive when the host offers it", async () => {
    client.policy = { methods: ["keyboard-interactive", "password"] };
    const terminal = screen(await hostShells().open(SIZE, WORDS));

    await terminal.shows("Password: ");
    terminal.type(`${PASSWORD}\r`);

    await vi.waitFor(() => expect(client.shell).toHaveBeenCalled());
    expect(client.tried).toEqual(["none", "keyboard-interactive"]);
  });

  it("asks for the password when keyboard-interactive asks nothing, as without PAM", async () => {
    client.policy = { methods: ["keyboard-interactive", "password"], keyboardPrompts: false };
    const terminal = screen(await hostShells().open(SIZE, WORDS));

    await terminal.shows("Mot de passe de thomas@server.lan : ");
    terminal.type(`${PASSWORD}\r`);

    await vi.waitFor(() => expect(client.shell).toHaveBeenCalled());
    expect(client.tried).toEqual(["none", "keyboard-interactive", "password"]);
    expect(terminal.text).not.toContain("Accès refusé");
  });

  it("stops on Ctrl+C", async () => {
    const terminal = screen(await hostShells().open(SIZE, WORDS));

    await terminal.shows("Mot de passe de");
    terminal.type("\x03");

    await terminal.ends();
    expect(terminal.text).toContain("Connexion annulée.");
  });
});

describe("HostShells sign-in with an imported key", () => {
  it("tries the key first, and asks for nothing when the host takes it", async () => {
    const { privateKey, publicKey } = keyPair();

    await writeFile(path.join(directory, "id_key"), privateKey);
    client.policy = { methods: ["publickey", "password"], authorizedKey: publicKey };
    const terminal = screen(await hostShells().open(SIZE, WORDS));

    await vi.waitFor(() => expect(client.shell).toHaveBeenCalled());
    expect(client.tried).toEqual(["publickey"]);
    expect(terminal.text).not.toContain("Mot de passe");
  });

  it("asks for an encrypted key's passphrase, then signs in with it", async () => {
    const { privateKey, publicKey } = keyPair({ passphrase: "phrase" });

    await writeFile(path.join(directory, "id_key"), privateKey);
    client.policy = { methods: ["publickey"], authorizedKey: publicKey };
    const terminal = screen(await hostShells().open(SIZE, WORDS));

    await terminal.shows("Phrase de passe de la clé : ");
    terminal.type("nope\r");
    await terminal.shows("Phrase de passe incorrecte.");
    terminal.type("phrase\r");

    await vi.waitFor(() => expect(client.shell).toHaveBeenCalled());
  });

  it("falls back to the password when the host refuses the key", async () => {
    await writeFile(path.join(directory, "id_key"), keyPair().privateKey);
    const terminal = screen(await hostShells().open(SIZE, WORDS));

    await terminal.shows("Mot de passe de");
    terminal.type(`${PASSWORD}\r`);

    await vi.waitFor(() => expect(client.shell).toHaveBeenCalled());
    expect(client.tried).toEqual(["publickey", "password"]);
  });
});

describe("HostShells failures", () => {
  it("refuses a host whose key changed since the first connection", async () => {
    await new SshKnownHosts(path.join(directory, "known_hosts")).verify("server.lan:22", Buffer.from("old key"));
    const terminal = screen(await hostShells().open(SIZE, WORDS));

    await terminal.ends();
    expect(terminal.text).toContain("La clé de server.lan:22 a changé depuis la première connexion");
    expect(client.tried).toEqual([]);
  });

  it("says the host is out of reach, and survives ssh2's second error", async () => {
    client.socketError = new Error("connect ECONNREFUSED 10.0.0.2:22");
    const terminal = screen(await hostShells().open(SIZE, WORDS));

    await terminal.ends();
    expect(terminal.text).toContain("Impossible de joindre server.lan:22 : connect ECONNREFUSED 10.0.0.2:22");
  });

  it("says why each address failed, for a host that resolves to several", async () => {
    client.socketError = new AggregateError(
      [new Error("connect ECONNREFUSED 172.17.0.1:22"), new Error("connect ENETUNREACH fd00::1:22")],
      "",
    );

    const terminal = screen(await hostShells().open(SIZE, WORDS));

    await terminal.ends();
    expect(terminal.text).toContain(
      "Impossible de joindre server.lan:22 : connect ECONNREFUSED 172.17.0.1:22, connect ENETUNREACH fd00::1:22",
    );
  });
});

describe("HostShells shell", () => {
  it("resizes the TTY and ends by closing the connection", async () => {
    const shell = await hostShells().open(SIZE, WORDS);
    const terminal = screen(shell);

    await terminal.shows("Mot de passe de");
    terminal.type(`${PASSWORD}\r`);
    await vi.waitFor(() => expect(client.shell).toHaveBeenCalled());

    await shell.resize({ cols: 120, rows: 40 });
    await shell.end();

    expect(client.channel.setWindow).toHaveBeenLastCalledWith(40, 120, 0, 0);
    expect(client.end).toHaveBeenCalledOnce();
  });
});
