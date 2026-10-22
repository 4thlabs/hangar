import { describe, expect, it } from "vitest";
import { TerminalOutbox } from "./terminal-outbox.ts";
import type { TerminalMessage } from "./terminal-protocol.ts";

/** Requests the test lands by hand, to hold them in flight. */
function heldRequests() {
  const sent: TerminalMessage[] = [];
  const pending: (() => void)[] = [];

  const send = (message: TerminalMessage) =>
    new Promise<void>(resolve => {
      sent.push(message);
      pending.push(resolve);
    });

  /** Lands the oldest request in flight, and lets the next one go out. */
  async function land() {
    pending.shift()?.();
    await new Promise(resolve => setImmediate(resolve));
  }

  return { sent, send, land };
}

describe("TerminalOutbox", () => {
  it("keeps one request in flight and sends what was typed meanwhile together, in order", async () => {
    const { sent, send, land } = heldRequests();
    const outbox = new TerminalOutbox(send);

    outbox.type("l");
    outbox.type("s");
    outbox.type("\r");

    expect(sent).toEqual([{ input: "l" }]);

    await land();

    expect(sent).toEqual([{ input: "l" }, { input: "s\r" }]);
  });

  it("sends only the latest of the sizes queued while a request was in flight, before the input", async () => {
    const { sent, send, land } = heldRequests();
    const outbox = new TerminalOutbox(send);

    outbox.type("a");
    outbox.type("b");
    outbox.resize({ cols: 90, rows: 20 });
    outbox.resize({ cols: 120, rows: 40 });
    await land();
    await land();

    expect(sent).toEqual([{ input: "a" }, { cols: 120, rows: 40 }, { input: "b" }]);
  });

  it("splits a paste larger than a request carries, never inside a surrogate pair", async () => {
    const { sent, send, land } = heldRequests();
    const outbox = new TerminalOutbox(send);

    outbox.type(`${"a".repeat(64 * 1_024 - 1)}😀b`);
    await land();

    const batches = sent.map(message => ("input" in message ? message.input : ""));

    expect(batches.map(batch => batch.length)).toEqual([64 * 1_024 - 1, 3]);
    expect(batches[1]).toBe("😀b");
  });
});
