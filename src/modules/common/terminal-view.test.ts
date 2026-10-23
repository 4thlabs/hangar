// @vitest-environment happy-dom
import type { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { TerminalView } from "./terminal-view.ts";

/** Records what reaches the terminal, and whether its input was on then; parses each write at once. */
function fakeTerminal() {
  const writes: { text: string; inputOn: boolean }[] = [];

  const terminal = {
    options: { disableStdin: false },
    write(data: Uint8Array, parsed?: () => void) {
      writes.push({ text: Buffer.from(data).toString(), inputOn: !terminal.options.disableStdin });
      parsed?.();
    },
  };

  return { terminal: terminal as unknown as Terminal, writes };
}

/** A session's output, in the chunks the network would cut it into. */
function outputOf(...chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }

      controller.close();
    },
  });
}

describe("TerminalView.follow", () => {
  it("takes the replay with its input off, so a query in it goes unanswered, then the live output with it on", async () => {
    const { terminal, writes } = fakeTerminal();
    // A device attributes query (`ESC [ c`) in the replay, which ends in the middle of the second chunk.
    const replay = "vim\x1b[c:wq\r\n";

    await TerminalView.follow(
      terminal,
      outputOf("vim\x1b[c", ":wq\r\n$ "),
      new AbortController().signal,
      replay.length,
    );

    expect(writes).toEqual([
      { text: "vim\x1b[c", inputOn: false },
      { text: ":wq\r\n", inputOn: false },
      { text: "$ ", inputOn: true },
    ]);

    expect(terminal.options.disableStdin).toBe(false);
  });

  it("leaves the input on without a replay", async () => {
    const { terminal, writes } = fakeTerminal();

    await TerminalView.follow(terminal, outputOf("$ "), new AbortController().signal, 0);

    expect(writes).toEqual([{ text: "$ ", inputOn: true }]);
  });
});
