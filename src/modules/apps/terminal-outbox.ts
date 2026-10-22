import type { TerminalSize } from "#libs/docker";
import { TerminalProtocol, type TerminalMessage } from "./terminal-protocol.ts";

/**
 * A terminal's messages on their way to its session, one request at a time: two in flight could land in
 * either order. What is typed meanwhile is gathered into the next request, and only the latest size is sent.
 */
export class TerminalOutbox {
  /** Sends one message; reports its own failures, as a rejection would stop every later message. */
  private readonly send: (message: TerminalMessage) => Promise<void>;

  private pendingInput = "";

  private pendingSize: TerminalSize | null = null;

  private sending = false;

  constructor(send: (message: TerminalMessage) => Promise<void>) {
    this.send = send;
  }

  /** Queues keystrokes, sent at once when no request is in flight, else right after it. */
  type(input: string): void {
    this.pendingInput += input;
    void this.flush();
  }

  /** Queues the terminal's new size; one a later resize replaced before it went out is never sent. */
  resize(size: TerminalSize): void {
    this.pendingSize = size;
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.sending) {
      return;
    }

    this.sending = true;

    try {
      while (this.pendingSize || this.pendingInput) {
        await this.send(this.next());
      }
    } finally {
      this.sending = false;
    }
  }

  /** The size first: what follows is typed into a terminal of that size. */
  private next(): TerminalMessage {
    if (this.pendingSize) {
      const size = this.pendingSize;

      this.pendingSize = null;

      return size;
    }

    const batch = TerminalOutbox.batch(this.pendingInput);

    this.pendingInput = this.pendingInput.slice(batch.length);

    return { input: batch };
  }

  /** As much of `text` as one request carries, never splitting a surrogate pair across two. */
  private static batch(text: string): string {
    const batch = text.slice(0, TerminalProtocol.MaxInputLength);
    const lastCode = batch.charCodeAt(batch.length - 1);
    const splitsPair = batch.length < text.length && lastCode >= 0xd800 && lastCode <= 0xdbff;

    return splitsPair ? batch.slice(0, -1) : batch;
  }
}
