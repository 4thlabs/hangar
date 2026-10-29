import { describe, expect, it } from "vitest";
import { SettingsTab } from "#modules/settings/settings-tab.ts";

describe("SettingsTab", () => {
  it("opens the tab the hash names, with or without its #", () => {
    expect(SettingsTab.parse("#jobs")).toBe("jobs");
    expect(SettingsTab.parse("env")).toBe("env");
  });

  it("opens the first tab for an empty or unknown hash", () => {
    expect(SettingsTab.parse("")).toBe("store");
    expect(SettingsTab.parse("#nope")).toBe("store");
  });

  it("links to the settings page on a tab", () => {
    expect(SettingsTab.href("config")).toBe("/settings#config");
  });
});
