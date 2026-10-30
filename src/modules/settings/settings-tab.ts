/** One tab of the settings page. */
export type SettingsTabId = "store" | "env" | "config" | "jobs" | "hangar";

type SettingsTabEntry = { id: SettingsTabId; label: string };

/**
 * The tabs of `/settings`, and the URL hash that opens each one. A hash rather than a query: switching tabs
 * stays in the browser, where a query would render the page again, Docker and git reads included.
 */
export class SettingsTab {
  /** In the order the page lists them; the first one opens when the hash names none. */
  static readonly All: readonly SettingsTabEntry[] = [
    { id: "store", label: "Store" },
    { id: "env", label: "Environnement" },
    { id: "config", label: "Configuration" },
    { id: "jobs", label: "Jobs" },
    { id: "hangar", label: "Hangar" },
  ];

  /** The tab a URL hash names, with or without its `#`; the first tab for any other hash. */
  static parse(hash: string): SettingsTabId {
    const id = hash.replace(/^#/, "");

    return SettingsTab.All.find(tab => tab.id === id)?.id ?? SettingsTab.All[0]!.id;
  }

  /** The link that opens the settings page on `tab`. */
  static href(tab: SettingsTabId): `/settings#${SettingsTabId}` {
    return `/settings#${tab}`;
  }
}
