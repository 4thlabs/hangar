import { m } from "#paraglide/messages.js";

export type NavigationPath = "/" | "/apps" | "/cluster" | "/store" | "/settings";

type NavigationItem = {
  /** Its words, called where they are shown. */
  label: () => string;
  href: NavigationPath;
};

type NavigationCategory = {
  /** Its words, called where they are shown. */
  label: () => string;
  position?: "bottom";
  items: readonly NavigationItem[];
};

/** The sections of the app, in the order the navbar and the phone's tab bar list them. */
export const navigationCategories: readonly NavigationCategory[] = [
  {
    label: m.common_navigation_general,
    items: [
      { label: m.common_navigation_dashboard, href: "/" },
      { label: m.common_navigation_apps, href: "/apps" },
      { label: m.common_navigation_cluster, href: "/cluster" },
      { label: m.common_navigation_store, href: "/store" },
    ],
  },
  {
    label: m.common_navigation_administration,
    position: "bottom",
    items: [{ label: m.common_navigation_settings, href: "/settings" }],
  },
];

/**
 * Whether `href` is the section the router is currently in.
 * A prefix match, so `/apps/alpha` keeps Apps active; `/` is exact, or it would match everything.
 */
export function isNavigationActive(path: string, href: NavigationPath) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}
