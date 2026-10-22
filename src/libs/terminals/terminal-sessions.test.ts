import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalNotFoundError, TerminalSessions, type TerminalShell } from "./terminal-sessions.ts";

const SIZE = { cols: 100, rows: 30 };

/** A started shell over an in-memory TTY, its resize and end recorded. */
function fakeShell() {
  return {
    stream: new PassThrough(),
    target: { host: "server.lan" },
    resize: vi.fn<TerminalShell["resize"]>().mockResolvedValue(undefined),
    end: vi.fn<TerminalShell["end"]>().mockResolvedValue(undefined),
  };
}

/** Lets the detached close (the shell's end) run. */
const settle = () => new Promise(resolve => setImmediate(resolve));

let shell: ReturnType<typeof fakeShell>;

beforeEach(() => {
  shell = fakeShell();
});

describe("TerminalSessions.open", () => {
  it("streams the shell's output", () => {
    const { output } = new TerminalSessions().open("user-1", shell, new AbortController().signal);

    shell.stream.write("$ ");

    expect(output.read()).toEqual(Buffer.from("$ "));
  });

  it("sends a byte the terminal ignores while the shell is idle, so no proxy times the stream out", () => {
    vi.useFakeTimers();

    try {
      const { output } = new TerminalSessions().open("user-1", shell, new AbortController().signal);

      vi.advanceTimersByTime(30_000);

      expect(output.read()).toEqual(Buffer.from("\0"));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TerminalSessions.write and resize", () => {
  it("types into the shell and resizes its TTY", async () => {
    const subject = new TerminalSessions();
    const { id } = subject.open("user-1", shell, new AbortController().signal);
    // The fake TTY echoes into the output, so what reaches it is read from its `write`.
    const typed = vi.spyOn(shell.stream, "write");

    subject.write(id, "user-1", "ls\r");
    await subject.resize(id, "user-1", SIZE);

    expect(typed).toHaveBeenCalledWith("ls\r");
    expect(shell.resize).toHaveBeenCalledWith(SIZE);
  });

  it("answers its owner only", async () => {
    const subject = new TerminalSessions();
    const { id } = subject.open("user-1", shell, new AbortController().signal);

    expect(() => subject.write(id, "user-2", "ls\r")).toThrow(TerminalNotFoundError);
    await expect(subject.resize(id, "user-2", SIZE)).rejects.toBeInstanceOf(TerminalNotFoundError);
  });
});

describe("TerminalSessions closing", () => {
  it("ends the shell and forgets the session when the client leaves", async () => {
    const subject = new TerminalSessions();
    const controller = new AbortController();
    const { id } = subject.open("user-1", shell, controller.signal);

    controller.abort();
    await settle();

    expect(shell.stream.destroyed).toBe(true);
    expect(shell.end).toHaveBeenCalledOnce();
    expect(() => subject.write(id, "user-1", "ls\r")).toThrow(TerminalNotFoundError);
  });

  it("closes a session whose client left while the shell started", async () => {
    const controller = new AbortController();

    controller.abort();
    new TerminalSessions().open("user-1", shell, controller.signal);
    await settle();

    expect(shell.stream.destroyed).toBe(true);
    expect(shell.end).toHaveBeenCalledOnce();
  });

  it("ends the output and forgets the session when the shell exits", async () => {
    const subject = new TerminalSessions();
    const { id, output } = subject.open("user-1", shell, new AbortController().signal);
    const ended = new Promise(resolve => output.once("end", resolve));

    output.resume();
    shell.stream.end();

    await ended;
    await settle();
    expect(() => subject.write(id, "user-1", "ls\r")).toThrow(TerminalNotFoundError);
    expect(shell.end).toHaveBeenCalledOnce();
  });

  it("survives a shell that fails to end", async () => {
    const controller = new AbortController();

    shell.end.mockRejectedValue(new Error("container stopped"));
    new TerminalSessions().open("user-1", shell, controller.signal);
    controller.abort();
    await settle();

    expect(shell.end).toHaveBeenCalledOnce();
  });
});
