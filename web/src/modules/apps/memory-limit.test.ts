import { describe, expect, it } from "vitest";
import { availableMemory } from "./memory-limit.ts";

const host = 16 * 1024 ** 3;

describe("availableMemory", () => {
  it("is the host's memory once, whatever the number of containers with no limit of their own", () => {
    expect(availableMemory([host, host, host], host)).toEqual({ bytes: host, isHost: true });
    expect(availableMemory([512, host], host)).toEqual({ bytes: host, isHost: true });
  });

  it("sums the containers' own limits, up to the host's memory", () => {
    expect(availableMemory([512, 1_024], host)).toEqual({ bytes: 1_536, isHost: false });
    expect(availableMemory([host - 1, host - 1], host)).toEqual({ bytes: host, isHost: true });
  });

  it("is unknown before a container or the host has a reading", () => {
    expect(availableMemory([], host)).toBeNull();
    expect(availableMemory([512], undefined)).toBeNull();
  });
});
