import type { LucideIcon } from "lucide-react";
import { BoxesIcon, LayoutDashboardIcon, SettingsIcon, StoreIcon } from "lucide-react";

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
 * Whether `href` is the section the router is currently in.
 *
 * Prefix, not equality: `/apps/alpha` belongs to Apps, and an exact match would black out the
 * tab as soon as you open an app. `/` is the exception — as a prefix it would match everything.
 */
export function isNavigationActive(path: string, href: NavigationPath) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}
