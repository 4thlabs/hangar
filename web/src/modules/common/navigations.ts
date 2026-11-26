import { BoxesIcon, LayoutDashboardIcon, NetworkIcon, SettingsIcon, StoreIcon, type LucideIcon } from "lucide-react";

export type NavigationPath = "/" | "/apps" | "/cluster" | "/store" | "/settings";

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

/** The sections of the app, in the order the navbar and the phone's tab bar list them. */
export const navigationCategories: readonly NavigationCategory[] = [
  {
    label: "General",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboardIcon },
      { label: "Apps", href: "/apps", icon: BoxesIcon },
      { label: "Cluster", href: "/cluster", icon: NetworkIcon },
      { label: "Store", href: "/store", icon: StoreIcon },
    ],
  },
  {
    label: "Administration",
    position: "bottom",
    items: [{ label: "Settings", href: "/settings", icon: SettingsIcon }],
  },
];

/**
 * Whether `href` is the section the router is currently in.
 * A prefix match, so `/apps/alpha` keeps Apps active; `/` is exact, or it would match everything.
 */
export function isNavigationActive(path: string, href: NavigationPath) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}
