import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

/**
 * The xterm terminal of a shell, in the app's font and colors, kept fitted to its element.
 * Loaded with the terminal panel only: xterm touches `window` on load.
 */
export class TerminalView {
  private static readonly FontFamily = '"JetBrains Mono Variable", monospace';

  private static readonly FontSize = 13;

  /**
   * Opens a terminal in `element`, disposed when `signal` aborts. The font is awaited first: xterm measures
   * its cells once, and nothing else on the page may have needed it yet.
   * @returns `null` when `signal` aborted meanwhile
   */
  static async open(element: HTMLElement, signal: AbortSignal): Promise<Terminal | null> {
    await document.fonts.load(`${TerminalView.FontSize}px ${TerminalView.FontFamily}`);

    if (signal.aborted) {
      return null;
    }

    const style = getComputedStyle(element);

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: TerminalView.FontFamily,
      fontSize: TerminalView.FontSize,
      theme: {
        background: style.getPropertyValue("--muted"),
        foreground: style.getPropertyValue("--foreground"),
        cursor: style.getPropertyValue("--foreground"),
      },
    });

    const fit = new FitAddon();
    // A hidden element's size reads `auto`, which the addon skips: the tab behind keeps its last size.
    const observer = new ResizeObserver(() => fit.fit());

    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();
    observer.observe(element);
    signal.addEventListener("abort", () => {
      observer.disconnect();
      terminal.dispose();
    });

    return terminal;
  }

  /**
   * Writes a session's output until it ends. Bytes, not text: xterm decodes UTF-8 across chunks itself.
   * @param replayedBytes How many bytes the output starts with that the shell sent to an earlier client.
   *   The terminal takes them with its input off: the queries they hold (a cursor position, the terminal's
   *   kind) were answered then, and an answer now would reach the shell as keystrokes.
   */
  static async follow(
    terminal: Terminal,
    output: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    replayedBytes: number,
  ): Promise<void> {
    const reader = output.getReader();
    let replayLeft = replayedBytes;

    terminal.options.disableStdin = replayLeft > 0;

    while (!signal.aborted) {
      const { done, value } = await reader.read();

      if (done) {
        return;
      }

      const replayed = value.subarray(0, replayLeft);
      const live = value.subarray(replayed.length);

      replayLeft -= replayed.length;

      if (replayed.length > 0) {
        // The callback runs once xterm has parsed the end of the replay, before anything written after it.
        terminal.write(replayed, replayLeft === 0 ? () => TerminalView.listen(terminal) : undefined);
      }

      if (live.length > 0) {
        terminal.write(live);
      }
    }
  }

  /** Turns the terminal's input back on, the replay parsed. */
  private static listen(terminal: Terminal): void {
    terminal.options.disableStdin = false;
  }
}
