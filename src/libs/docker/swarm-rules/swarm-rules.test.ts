import { describe, expect, it } from "vitest";
import { SwarmRules } from "./swarm-rules.ts";

const worker = { role: "worker", status: "ready", availability: "active", isRaftMember: false } as const;
const manager = { role: "manager", status: "ready", availability: "active", isRaftMember: true } as const;

/** A worker promoted while out of reach: a manager in its spec, never in Raft. */
const unjoined = { ...manager, isRaftMember: false } as const;

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

  it("offers removal for any node outside Raft the daemon no longer sees ready", () => {
    expect(SwarmRules.nodeActions({ ...worker, status: "down" }, 1)).toContain("remove");
    expect(SwarmRules.nodeActions({ ...worker, status: "unknown" }, 1)).toContain("remove");
    expect(SwarmRules.nodeActions(worker, 1)).not.toContain("remove");
    expect(SwarmRules.nodeActions({ ...manager, status: "down" }, 3)).not.toContain("remove");
  });

  it("offers a manager that never joined Raft its removal instead of a demotion the daemon refuses", () => {
    expect(SwarmRules.nodeActions({ ...unjoined, status: "down" }, 3)).toEqual(["drain", "remove"]);
    expect(SwarmRules.nodeActions(unjoined, 3)).toEqual(["drain"]);
  });
});

describe("SwarmRules.nodeRefusal", () => {
  it("names why an action does not apply", () => {
    expect(SwarmRules.nodeRefusal("demote", manager, 1)).toBe("last-manager");
    expect(SwarmRules.nodeRefusal("remove", manager, 3)).toBe("manager-not-removable");
    expect(SwarmRules.nodeRefusal("remove", worker, 1)).toBe("node-not-down");
    expect(SwarmRules.nodeRefusal("promote", manager, 3)).toBe("already-done");
    expect(SwarmRules.nodeRefusal("demote", unjoined, 3)).toBe("not-raft-member");
  });
});

describe("SwarmRules.faultTolerance", () => {
  it("is how many managers can fail with a majority left", () => {
    expect([1, 2, 3, 4, 5, 7].map(managers => SwarmRules.faultTolerance(managers))).toEqual([0, 0, 1, 1, 2, 3]);
  });
});

describe("SwarmRules node labels", () => {
  it("takes the keys a placement constraint can name", () => {
    expect(["disk", "storage.tier", "zone-1", "GPU_vendor", "9a"].every(key => SwarmRules.isLabelKey(key))).toBe(true);
  });

  it("refuses a key a constraint could not name, or none at all", () => {
    expect(["", "-disk", ".zone", "my disk", "zone=home", "é", "a".repeat(129)].some(SwarmRules.isLabelKey)).toBe(
      false,
    );
  });

  it("takes any one-line value, an empty one included", () => {
    expect(["", "ssd", "Salle à manger", "10.0.0.1:2377"].every(value => SwarmRules.isLabelValue(value))).toBe(true);
  });

  it("refuses a value over several lines, or too long", () => {
    expect(["ssd\nzone=x", "tab\there", "a".repeat(256)].some(SwarmRules.isLabelValue)).toBe(false);
  });
});
