import { describe, expect, it } from "vitest";
import { MemoryLimit } from "./memory-limit.ts";

const host = 16 * 1024 ** 3;

describe("MemoryLimit", () => {
  it("is the host's memory once, whatever the number of containers with no limit of their own", () => {
    expect(MemoryLimit.available([host, host, host], host)).toEqual({ bytes: host, isHost: true });
    expect(MemoryLimit.available([512, host], host)).toEqual({ bytes: host, isHost: true });
  });

  it("sums the containers' own limits, up to the host's memory", () => {
    expect(MemoryLimit.available([512, 1_024], host)).toEqual({ bytes: 1_536, isHost: false });
    expect(MemoryLimit.available([host - 1, host - 1], host)).toEqual({ bytes: host, isHost: true });
  });

  it("is unknown before a container or the host has a reading", () => {
    expect(MemoryLimit.available([], host)).toBeNull();
    expect(MemoryLimit.available([512], undefined)).toBeNull();
  });
});
