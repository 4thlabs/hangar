import { describe, expect, it } from "vitest";
import { parseSettingsTab } from "./settings-tab.ts";

describe("parseSettingsTab", () => {
  it("opens the tab the hash names, with or without its #", () => {
    expect(parseSettingsTab("#env")).toBe("env");
    expect(parseSettingsTab("config")).toBe("config");
    expect(parseSettingsTab("#jobs")).toBe("jobs");
  });

  it("opens the first tab for a hash that names none", () => {
    expect(parseSettingsTab("")).toBe("store");
    expect(parseSettingsTab("#hangar")).toBe("store");
  });
});
