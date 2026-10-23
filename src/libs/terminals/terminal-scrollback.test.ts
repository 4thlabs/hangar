import { describe, expect, it } from "vitest";
import { TerminalScrollback } from "./terminal-scrollback.ts";

describe("TerminalScrollback", () => {
  it("keeps everything below its capacity", () => {
    const scrollback = new TerminalScrollback(16);

    scrollback.append(Buffer.from("$ ls\r\n"));
    scrollback.append(Buffer.from("a b\r\n"));

    expect(scrollback.contents().toString()).toBe("$ ls\r\na b\r\n");
  });

  it("keeps the latest bytes once full", () => {
    const scrollback = new TerminalScrollback(8);

    scrollback.append(Buffer.from("first\r\n"));
    scrollback.append(Buffer.from("second\r\n"));
    scrollback.append(Buffer.from("third\r\n"));

    expect(scrollback.contents().toString()).toBe("\nthird\r\n");
  });

  it("cuts a chunk larger than its capacity", () => {
    const scrollback = new TerminalScrollback(4);

    scrollback.append(Buffer.from("0123456789"));

    expect(scrollback.contents().toString()).toBe("6789");
  });

  it("is empty before any output", () => {
    expect(new TerminalScrollback(4).contents()).toHaveLength(0);
  });
});
