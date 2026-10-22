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

  /** Writes a session's output until it ends. Bytes, not text: xterm decodes UTF-8 across chunks itself. */
  static async follow(terminal: Terminal, output: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = output.getReader();

    while (!signal.aborted) {
      const { done, value } = await reader.read();

      if (done) {
        return;
      }

      terminal.write(value);
    }
  }
}
