import { describe, expect, it } from "vitest";
import { Navigations } from "./navigations.ts";

describe("Navigations.isActive", () => {
  it("keeps a section lit on its sub-routes", () => {
    expect(Navigations.isActive("/apps", "/apps")).toBe(true);
    expect(Navigations.isActive("/apps/alpha", "/apps")).toBe(true);
  });

  it("matches on segments, not on the string", () => {
    expect(Navigations.isActive("/appstore", "/apps")).toBe(false);
  });

  it("gives the dashboard no prefix, or it would match everything", () => {
    expect(Navigations.isActive("/", "/")).toBe(true);
    expect(Navigations.isActive("/store", "/")).toBe(false);
  });
});
