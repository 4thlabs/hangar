import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { BoxesIcon, LayoutDashboardIcon, NetworkIcon, SettingsIcon, StoreIcon, type LucideIcon } from "lucide-react";
import { useCurrentPath } from "#modules/common/hooks/use-current-path.ts";
import { isNavigationActive, navigationCategories, type NavigationPath } from "#routes/-shell/navigations.ts";

/** The icon of each section on the tab bar. */
const sectionIcons: Readonly<Record<NavigationPath, LucideIcon>> = {
  "/": LayoutDashboardIcon,
  "/apps": BoxesIcon,
  "/cluster": NetworkIcon,
  "/store": StoreIcon,
  "/settings": SettingsIcon,
};

/**
 * Phone tab bar. A second tree is fine here: stateless links only.
 * `sticky`, not `fixed`, so it reserves its own height and the page needs no bottom padding.
 */
export function MobileTabBar() {
  const path = useCurrentPath();
  const items = navigationCategories.flatMap(category => category.items);

  return (
    <nav
      className="sticky bottom-0 z-40 flex h-16 shrink-0 border-t border-sidebar-border bg-sidebar text-sidebar-foreground sm:hidden"
      aria-label="Main navigation"
    >
      {items.map(item => {
        const active = isNavigationActive(path, item.href);
        const Icon = sectionIcons[item.href];

        return (
          <Link
            key={item.href}
            to={item.href}
            aria-current={active ? "page" : undefined}
            preload="intent"
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
              // The same hairline the header's tabs draw under themselves, on the other edge.
              active
                ? "text-sidebar-foreground after:absolute after:inset-x-0 after:top-0 after:h-0.5 after:bg-sidebar-ring"
                : "text-sidebar-foreground/60",
            )}
          >
            <Icon className="size-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
