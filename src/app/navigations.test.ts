import { describe, expect, it } from "vitest";
import { isNavigationActive } from "./navigations.ts";

describe("isNavigationActive", () => {
  it("keeps a section lit on its sub-routes", () => {
    expect(isNavigationActive("/apps", "/apps")).toBe(true);
    expect(isNavigationActive("/apps/alpha", "/apps")).toBe(true);
  });

  it("matches on segments, not on the string", () => {
    expect(isNavigationActive("/appstore", "/apps")).toBe(false);
  });

  it("gives the dashboard no prefix, or it would match everything", () => {
    expect(isNavigationActive("/", "/")).toBe(true);
    expect(isNavigationActive("/store", "/")).toBe(false);
  });
});
