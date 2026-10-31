import { PassThrough, type Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalNotFoundError, TerminalSessions, type TerminalShell } from "./terminal-sessions.ts";

/** What a client the session is taken from is told. */
const TAKEN_OVER = "Session taken over in another tab.";

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

/** Everything a client's output holds so far, as text. */
const shown = (output: Readable) => (output.read() as Buffer | null)?.toString() ?? "";

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

describe("TerminalSessions.close", () => {
  it("ends a session at its owner's request", async () => {
    const subject = new TerminalSessions();
    const { id } = subject.open("user-1", shell, new AbortController().signal);

    await subject.close(id, "user-1");

    expect(shell.end).toHaveBeenCalledOnce();
    expect(() => subject.write(id, "user-1", "ls\r")).toThrow(TerminalNotFoundError);
  });

  it("answers its owner only", async () => {
    const subject = new TerminalSessions();
    const { id } = subject.open("user-1", shell, new AbortController().signal);

    await expect(subject.close(id, "user-2")).rejects.toBeInstanceOf(TerminalNotFoundError);
    expect(shell.end).not.toHaveBeenCalled();
  });
});

describe("TerminalSessions.attach", () => {
  /** Starts `shell` the first time, and records the size it was asked for. */
  const start = vi.fn(async () => shell);

  beforeEach(() => {
    start.mockClear();
  });

  it("starts the shell the first time, with nothing to replay", async () => {
    const subject = new TerminalSessions();

    const { output, replayedBytes } = await subject.attach(
      "user-1",
      "host",
      SIZE,
      start,
      new AbortController().signal,
      TAKEN_OVER,
    );

    shell.stream.write("$ ");

    expect(start).toHaveBeenCalledOnce();
    expect(replayedBytes).toBe(0);
    expect(shown(output)).toBe("$ ");
  });

  it("keeps the shell once the client leaves, and replays its output to the next one, sized to it", async () => {
    const subject = new TerminalSessions();
    const first = new AbortController();
    const opened = await subject.attach("user-1", "host", SIZE, start, first.signal, TAKEN_OVER);

    shell.stream.write("$ ls\r\n");
    first.abort();
    await settle();
    shell.stream.write("README.md\r\n");

    const reattached = await subject.attach(
      "user-1",
      "host",
      { cols: 80, rows: 24 },
      start,
      new AbortController().signal,
      TAKEN_OVER,
    );

    expect(start).toHaveBeenCalledOnce();
    expect(shell.end).not.toHaveBeenCalled();
    expect(reattached.id).toBe(opened.id);
    expect(shown(reattached.output)).toBe("$ ls\r\nREADME.md\r\n");
    expect(reattached.replayedBytes).toBe("$ ls\r\nREADME.md\r\n".length);
    expect(shell.resize).toHaveBeenCalledWith({ cols: 80, rows: 24 });
  });

  it("lets the shell write again for a client taking over from one that held it back", async () => {
    const subject = new TerminalSessions();

    await subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER);
    // Never read by the first client: its output fills up, and the shell is paused.
    shell.stream.write(Buffer.alloc(64 * 1_024, "x"));
    await settle();

    const second = await subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER);

    shell.stream.write("$ ");
    await settle();

    expect(shown(second.output).endsWith("$ ")).toBe(true);
  });

  it("hands the session over to a second client, and tells the first", async () => {
    const subject = new TerminalSessions();
    const first = await subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER);
    const firstEnded = new Promise(resolve => first.output.once("end", resolve));
    const firstShown: Buffer[] = [];

    first.output.on("data", (chunk: Buffer) => firstShown.push(chunk));

    const second = await subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER);

    shell.stream.write("$ ");

    await firstEnded;
    expect(Buffer.concat(firstShown).toString()).toContain(TAKEN_OVER);
    expect(shown(second.output)).toBe("$ ");
    expect(shell.end).not.toHaveBeenCalled();
  });

  it("stays with the second client when the first one's request ends", async () => {
    const subject = new TerminalSessions();
    const first = new AbortController();

    await subject.attach("user-1", "host", SIZE, start, first.signal, TAKEN_OVER);

    const second = await subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER);

    first.abort();
    await settle();
    shell.stream.write("$ ");

    expect(shown(second.output)).toBe("$ ");
  });

  it("starts one shell for two clients arriving at once", async () => {
    const subject = new TerminalSessions();

    const [first, second] = await Promise.all([
      subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER),
      subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER),
    ]);

    expect(start).toHaveBeenCalledOnce();
    expect(second.id).toBe(first.id);
  });

  it("keeps one session per user", async () => {
    const subject = new TerminalSessions();
    const otherShell = fakeShell();

    const mine = await subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER);

    const theirs = await subject.attach(
      "user-2",
      "host",
      SIZE,
      async () => otherShell,
      new AbortController().signal,
      TAKEN_OVER,
    );

    expect(theirs.id).not.toBe(mine.id);
    expect(() => subject.write(mine.id, "user-2", "ls\r")).toThrow(TerminalNotFoundError);
  });

  it("ends the shell after an hour without activity, with a client or without", async () => {
    vi.useFakeTimers();

    try {
      const subject = new TerminalSessions();
      const { id } = await subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER);

      await vi.advanceTimersByTimeAsync(59 * 60_000);
      expect(shell.end).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(shell.end).toHaveBeenCalledOnce();
      expect(() => subject.write(id, "user-1", "ls\r")).toThrow(TerminalNotFoundError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a session the client left, until an hour without activity", async () => {
    vi.useFakeTimers();

    try {
      const subject = new TerminalSessions();
      const client = new AbortController();

      await subject.attach("user-1", "host", SIZE, start, client.signal, TAKEN_OVER);
      client.abort();
      await vi.advanceTimersByTimeAsync(59 * 60_000);
      expect(shell.end).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(shell.end).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts keystrokes, resizes, output and a client coming back as activity", async () => {
    vi.useFakeTimers();

    try {
      const subject = new TerminalSessions();
      const client = new AbortController();
      const { id } = await subject.attach("user-1", "host", SIZE, start, client.signal, TAKEN_OVER);
      const almostAnHour = 59 * 60_000;

      await vi.advanceTimersByTimeAsync(almostAnHour);
      subject.write(id, "user-1", "ls\r");
      await vi.advanceTimersByTimeAsync(almostAnHour);
      await subject.resize(id, "user-1", SIZE);
      await vi.advanceTimersByTimeAsync(almostAnHour);
      shell.stream.write("$ ");
      await vi.advanceTimersByTimeAsync(almostAnHour);
      client.abort();
      await subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER);
      await vi.advanceTimersByTimeAsync(almostAnHour);

      expect(shell.end).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the idle timer of a session ended otherwise", async () => {
    vi.useFakeTimers();

    try {
      const subject = new TerminalSessions();
      const { id } = await subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER);

      await subject.close(id, "user-1");
      // Lets the streams' own end run.
      await vi.advanceTimersByTimeAsync(0);

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a container's session, which ends with its client, without an idle timeout", () => {
    vi.useFakeTimers();

    try {
      new TerminalSessions().open("user-1", shell, new AbortController().signal);

      vi.advanceTimersByTime(24 * 60 * 60_000);

      expect(shell.end).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a new shell once the previous one exited", async () => {
    const subject = new TerminalSessions();
    const client = new AbortController();
    const first = await subject.attach("user-1", "host", SIZE, start, client.signal, TAKEN_OVER);

    client.abort();
    await settle();
    shell.stream.end();
    await settle();

    const nextShell = fakeShell();

    const next = await subject.attach(
      "user-1",
      "host",
      SIZE,
      async () => nextShell,
      new AbortController().signal,
      TAKEN_OVER,
    );

    expect(next.id).not.toBe(first.id);
    expect(shell.end).toHaveBeenCalledOnce();
  });

  it("starts a new shell once its owner closed the previous one", async () => {
    const subject = new TerminalSessions();
    const first = await subject.attach("user-1", "host", SIZE, start, new AbortController().signal, TAKEN_OVER);

    await subject.close(first.id, "user-1");

    const next = await subject.attach(
      "user-1",
      "host",
      SIZE,
      async () => fakeShell(),
      new AbortController().signal,
      TAKEN_OVER,
    );

    expect(next.id).not.toBe(first.id);
  });
});

describe("TerminalSessions.closeAll", () => {
  it("ends every session of a user who signed out, and no one else's", async () => {
    const subject = new TerminalSessions();
    const containerShell = fakeShell();
    const otherShell = fakeShell();

    await subject.attach("user-1", "host", SIZE, async () => shell, new AbortController().signal, TAKEN_OVER);
    subject.open("user-1", containerShell, new AbortController().signal);
    subject.open("user-2", otherShell, new AbortController().signal);

    await subject.closeAll("user-1");

    expect(shell.end).toHaveBeenCalledOnce();
    expect(containerShell.end).toHaveBeenCalledOnce();
    expect(otherShell.end).not.toHaveBeenCalled();
  });

  it("starts a new shell when the user comes back", async () => {
    const subject = new TerminalSessions();

    const first = await subject.attach(
      "user-1",
      "host",
      SIZE,
      async () => shell,
      new AbortController().signal,
      TAKEN_OVER,
    );

    await subject.closeAll("user-1");

    const next = await subject.attach(
      "user-1",
      "host",
      SIZE,
      async () => fakeShell(),
      new AbortController().signal,
      TAKEN_OVER,
    );

    expect(next.id).not.toBe(first.id);
  });
});
