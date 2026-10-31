import { BoxesIcon, LayoutDashboardIcon, NetworkIcon, SettingsIcon, StoreIcon, type LucideIcon } from "lucide-react";
import type { CommonMessages } from "#modules/common/messages.ts";

type NavigationPath = "/" | "/apps" | "/cluster" | "/store" | "/settings";

/** A name under `navigation` in {@link CommonMessages}, resolved in the reader's language. */
type NavigationLabel = keyof typeof CommonMessages.en.navigation;

type NavigationItem = {
  label: NavigationLabel;
  href: NavigationPath;
  icon: LucideIcon;
};

type NavigationCategory = {
  label: NavigationLabel;
  position?: "bottom";
  items: readonly NavigationItem[];
};

export const navigations: readonly NavigationCategory[] = [
  {
    label: "general",
    items: [
      { label: "dashboard", href: "/", icon: LayoutDashboardIcon },
      { label: "apps", href: "/apps", icon: BoxesIcon },
      { label: "cluster", href: "/cluster", icon: NetworkIcon },
      { label: "store", href: "/store", icon: StoreIcon },
    ],
  },
  {
    label: "administration",
    position: "bottom",
    items: [{ label: "settings", href: "/settings", icon: SettingsIcon }],
  },
] as const;

/**
 * How a link prefetches its page, once on screen or once hovered. What matters is the page's
 * client code, which the browser loads while reading the prefetched response: without it, the first
 * visit to a page after a reload waits for its scripts behind the page's spinner. `ttl: 0` keeps no
 * response, so a click still fetches the page fresh.
 */
export const navigationPrefetch = { ttl: 0 };

/**
 * Whether `href` is the section the router is currently in.
 * A prefix match, so `/apps/alpha` keeps Apps active; `/` is exact, or it would match everything.
 */
export function isNavigationActive(path: string, href: NavigationPath) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}
