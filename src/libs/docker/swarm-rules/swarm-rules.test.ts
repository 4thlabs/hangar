import { describe, expect, it } from "vitest";
import { SwarmRules } from "./swarm-rules.ts";

const worker = { role: "worker", status: "ready", availability: "active" } as const;
const manager = { role: "manager", status: "ready", availability: "active" } as const;

describe("SwarmRules.nodeActions", () => {
  it("offers a ready, active worker promotion and draining", () => {
    expect(SwarmRules.nodeActions(worker, 1)).toEqual(["promote", "drain"]);
  });

  it("offers a manager demotion only while another manager remains", () => {
    expect(SwarmRules.nodeActions(manager, 3)).toEqual(["demote", "drain"]);
    expect(SwarmRules.nodeActions({ ...manager, role: "leader" }, 1)).toEqual(["drain"]);
  });

  it("offers a drained node its reactivation, and a paused one too", () => {
    expect(SwarmRules.nodeActions({ ...worker, availability: "drain" }, 1)).toEqual(["promote", "activate"]);
    expect(SwarmRules.nodeActions({ ...worker, availability: "pause" }, 1)).toEqual(["promote", "drain", "activate"]);
  });

  it("offers removal only for a worker that is down", () => {
    expect(SwarmRules.nodeActions({ ...worker, status: "down" }, 1)).toContain("remove");
    expect(SwarmRules.nodeActions({ ...worker, status: "disconnected" }, 1)).not.toContain("remove");
    expect(SwarmRules.nodeActions({ ...manager, status: "down" }, 3)).not.toContain("remove");
  });
});

describe("SwarmRules.nodeRefusal", () => {
  it("names why an action does not apply", () => {
    expect(SwarmRules.nodeRefusal("demote", manager, 1)).toBe("last-manager");
    expect(SwarmRules.nodeRefusal("remove", manager, 3)).toBe("manager-not-removable");
    expect(SwarmRules.nodeRefusal("remove", worker, 1)).toBe("node-not-down");
    expect(SwarmRules.nodeRefusal("promote", manager, 3)).toBe("already-done");
  });
});

describe("SwarmRules.faultTolerance", () => {
  it("is how many managers can fail with a majority left", () => {
    expect([1, 2, 3, 4, 5, 7].map(managers => SwarmRules.faultTolerance(managers))).toEqual([0, 0, 1, 1, 2, 3]);
  });
});
