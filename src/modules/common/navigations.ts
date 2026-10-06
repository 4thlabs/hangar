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
 * Whether `href` is the section the router is currently in.
 * A prefix match, so `/apps/alpha` keeps Apps active; `/` is exact, or it would match everything.
 */
export function isNavigationActive(path: string, href: NavigationPath) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}
