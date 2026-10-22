import { EventEmitter } from "node:events";
import type { ClientChannel } from "ssh2";
import { describe, expect, it, vi } from "vitest";
import { SshTerminal } from "./ssh-terminal.ts";

const SIZE = { cols: 80, rows: 24 };

/** Everything the terminal showed so far, as text. */
function shown(terminal: SshTerminal): string {
  let text = "";
  let chunk: Buffer | null;

  while ((chunk = terminal.stream.read() as Buffer | null) !== null) {
    text += chunk.toString();
  }

  return text;
}

/** A shell channel: what the terminal types into it is recorded, what it emits is shown. */
function fakeChannel() {
  return Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    write: vi.fn(),
    setWindow: vi.fn(),
    close: vi.fn(),
  });
}

describe("SshTerminal.ask", () => {
  it("reads the line typed, hiding it when asked to", async () => {
    const terminal = new SshTerminal(SIZE);
    const answer = terminal.ask("Mot de passe : ", false);

    terminal.stream.write("sec");
    terminal.stream.write("ret\r");

    await expect(answer).resolves.toBe("secret");
    expect(shown(terminal)).toBe("Mot de passe : \r\n");
  });

  it("shows what is typed when the question echoes, and erases it with backspace", async () => {
    const terminal = new SshTerminal(SIZE);
    const answer = terminal.ask("Code : ", true);

    terminal.stream.write("12x\x7f3\r");

    await expect(answer).resolves.toBe("123");
    expect(shown(terminal)).toBe("Code : 12x\b \b3\r\n");
  });

  it("clears the line with Ctrl+U, and ignores arrows and control keys", async () => {
    const terminal = new SshTerminal(SIZE);
    const answer = terminal.ask("Mot de passe : ", false);

    terminal.stream.write("wrong\x15");
    terminal.stream.write("\x1b[A");
    terminal.stream.write("ri\tght\r");

    await expect(answer).resolves.toBe("right");
  });

  it("gives up on Ctrl+C, and on Ctrl+D before any input", async () => {
    const terminal = new SshTerminal(SIZE);
    const interrupted = terminal.ask("Mot de passe : ", false);

    terminal.stream.write("abc\x03");
    await expect(interrupted).resolves.toBeNull();

    const ended = terminal.ask("Mot de passe : ", false);

    terminal.stream.write("\x04");
    await expect(ended).resolves.toBeNull();
  });

  it("gives up when the client leaves", async () => {
    const terminal = new SshTerminal(SIZE);
    const answer = terminal.ask("Mot de passe : ", false);

    terminal.stream.destroy();

    await expect(answer).resolves.toBeNull();
  });

  it("drops what is typed while no question waits", async () => {
    const terminal = new SshTerminal(SIZE);

    terminal.stream.write("early\r");
    const answer = terminal.ask("Mot de passe : ", false);

    terminal.stream.write("late\r");

    await expect(answer).resolves.toBe("late");
  });
});

describe("SshTerminal.attach", () => {
  it("hands the keys and the output to the shell, at the client's latest size", () => {
    const terminal = new SshTerminal(SIZE);
    const channel = fakeChannel();

    terminal.resize({ cols: 120, rows: 40 });
    terminal.attach(channel as unknown as ClientChannel);
    terminal.stream.write("ls\r");
    channel.emit("data", Buffer.from([0xe2, 0x82]));
    channel.emit("data", Buffer.from([0xac]));

    expect(channel.write).toHaveBeenCalledWith("ls\r");
    expect(channel.setWindow).toHaveBeenCalledWith(40, 120, 0, 0);
    // Bytes stay bytes: a character split across chunks reaches xterm whole.
    expect(shown(terminal)).toBe("€");
  });

  it("closes once the shell exits and its output is read", async () => {
    const terminal = new SshTerminal(SIZE);
    const channel = fakeChannel();
    const closed = new Promise(resolve => terminal.stream.once("close", resolve));

    terminal.attach(channel as unknown as ClientChannel);
    terminal.stream.resume();
    channel.emit("close");

    await closed;
  });

  it("closes a shell that opened after the client left", () => {
    const terminal = new SshTerminal(SIZE);
    const channel = fakeChannel();

    terminal.stream.destroy();
    terminal.attach(channel as unknown as ClientChannel);

    expect(channel.close).toHaveBeenCalledOnce();
  });
});
