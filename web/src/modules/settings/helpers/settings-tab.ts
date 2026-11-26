/** One tab of the settings page. */
export type SettingsTabId = "store" | "env" | "config" | "jobs";

/** A tab, and its label. */
type SettingsTabEntry = { id: SettingsTabId; label: string };

// The tabs of `/settings`, and the URL hash that opens each one: a link or the spotlight opens any of them. Hangar's
// update of itself comes with the issue of its area.

/** The tabs, in the order the page lists them; the first one opens when the hash names none. */
export const settingsTabs: readonly SettingsTabEntry[] = [
  { id: "store", label: "Store" },
  { id: "env", label: "Environment" },
  { id: "config", label: "Configuration" },
  { id: "jobs", label: "Jobs" },
];

/** The tab a URL hash names, with or without its `#`; the first tab for any other hash. */
export function parseSettingsTab(hash: string): SettingsTabId {
  const id = hash.replace(/^#/, "");

  return settingsTabs.find(tab => tab.id === id)?.id ?? settingsTabs[0]!.id;
}
