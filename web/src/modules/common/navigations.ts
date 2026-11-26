import { BoxesIcon, LayoutDashboardIcon, NetworkIcon, SettingsIcon, StoreIcon, type LucideIcon } from "lucide-react";
import type { CommonMessages } from "#modules/common/messages.ts";

export type NavigationPath = "/" | "/apps" | "/cluster" | "/store" | "/settings";

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

/** The sections of the app, in the order the navbar and the phone's tab bar list them. */
export class Navigations {
  static readonly Categories: readonly NavigationCategory[] = [
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
  ];

  /**
   * Whether `href` is the section the router is currently in.
   * A prefix match, so `/apps/alpha` keeps Apps active; `/` is exact, or it would match everything.
   */
  static isActive(path: string, href: NavigationPath) {
    return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
  }
}
