import type { LucideIcon } from "lucide-react";
import { LayoutDashboardIcon, SettingsIcon } from "lucide-react";

type NavigationPath = "/" | "/settings";

type NavigationItem = {
  label: string;
  href: NavigationPath;
  icon: LucideIcon;
};

type NavigationCategory = {
  label: string;
  items: readonly NavigationItem[];
};

export const navigations = [
  {
    label: "Général",
    items: [{ label: "Dashboard", href: "/", icon: LayoutDashboardIcon }],
  },
  {
    label: "Administration",
    items: [{ label: "Paramètres", href: "/settings", icon: SettingsIcon }],
  },
] as const satisfies readonly NavigationCategory[];
