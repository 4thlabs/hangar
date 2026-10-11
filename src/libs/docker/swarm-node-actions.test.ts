import { describe, expect, it } from "vitest";
import { swarmNodeActions, swarmNodeRefusal } from "./swarm-node-actions.ts";

const worker = { role: "worker", status: "ready", availability: "active" } as const;
const manager = { role: "manager", status: "ready", availability: "active" } as const;

describe("swarmNodeActions", () => {
  it("offers a ready, active worker promotion and draining", () => {
    expect(swarmNodeActions(worker, 1)).toEqual(["promote", "drain"]);
  });

  it("offers a manager demotion only while another manager remains", () => {
    expect(swarmNodeActions(manager, 3)).toEqual(["demote", "drain"]);
    expect(swarmNodeActions({ ...manager, role: "leader" }, 1)).toEqual(["drain"]);
  });

  it("offers a drained node its reactivation, and a paused one too", () => {
    expect(swarmNodeActions({ ...worker, availability: "drain" }, 1)).toEqual(["promote", "activate"]);
    expect(swarmNodeActions({ ...worker, availability: "pause" }, 1)).toEqual(["promote", "drain", "activate"]);
  });

  it("offers removal only for a worker that is down", () => {
    expect(swarmNodeActions({ ...worker, status: "down" }, 1)).toContain("remove");
    expect(swarmNodeActions({ ...worker, status: "disconnected" }, 1)).not.toContain("remove");
    expect(swarmNodeActions({ ...manager, status: "down" }, 3)).not.toContain("remove");
  });
});

describe("swarmNodeRefusal", () => {
  it("names why an action does not apply", () => {
    expect(swarmNodeRefusal("demote", manager, 1)).toBe("last-manager");
    expect(swarmNodeRefusal("remove", manager, 3)).toBe("manager-not-removable");
    expect(swarmNodeRefusal("remove", worker, 1)).toBe("node-not-down");
    expect(swarmNodeRefusal("promote", manager, 3)).toBe("already-done");
  });
});
