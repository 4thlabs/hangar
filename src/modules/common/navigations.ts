import { BoxesIcon, LayoutDashboardIcon, SettingsIcon, StoreIcon, type LucideIcon } from "lucide-react";

type NavigationPath = "/" | "/apps" | "/store" | "/settings";

type NavigationItem = {
  label: string;
  href: NavigationPath;
  icon: LucideIcon;
};

type NavigationCategory = {
  label: string;
  position?: "bottom";
  items: readonly NavigationItem[];
};

export const navigations: readonly NavigationCategory[] = [
  {
    label: "Général",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboardIcon },
      { label: "Apps", href: "/apps", icon: BoxesIcon },
      { label: "Store", href: "/store", icon: StoreIcon },
    ],
  },
  {
    label: "Administration",
    position: "bottom",
    items: [{ label: "Paramètres", href: "/settings", icon: SettingsIcon }],
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
