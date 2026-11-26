import { describe, expect, it } from "vitest";
import { SettingsTab } from "./settings-tab.ts";

describe("SettingsTab.parse", () => {
  it("opens the tab the hash names, with or without its #", () => {
    expect(SettingsTab.parse("#env")).toBe("env");
    expect(SettingsTab.parse("config")).toBe("config");
  });

  it("opens the first tab for a hash that names none", () => {
    expect(SettingsTab.parse("")).toBe("store");
    expect(SettingsTab.parse("#jobs")).toBe("store");
  });
});
