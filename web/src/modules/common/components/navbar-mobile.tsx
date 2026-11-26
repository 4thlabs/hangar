import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { SearchIcon } from "lucide-react";
import { NavbarSearch } from "#modules/common/components/searchbar.tsx";
import { useCurrentPath } from "#modules/common/hooks/use-current-path.ts";
import { Navigations } from "#modules/common/navigations.ts";
import { Button } from "#modules/common/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#modules/common/ui/sheet.tsx";

/** The magnifier and its sheet, which stand in for the search field until it fits at `md`. */
export function MobileSearch() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Open search" />}>
        <SearchIcon />
      </SheetTrigger>
      <SheetContent side="top">
        <SheetHeader>
          <SheetTitle>Search</SheetTitle>
          <SheetDescription>Search content in Hangar.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <NavbarSearch id="navbar-search-mobile" autoFocus />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Phone tab bar. A second tree is fine here: stateless links only.
 * `sticky`, not `fixed`, so it reserves its own height and the page needs no bottom padding.
 */
export function MobileTabBar() {
  const path = useCurrentPath();
  const items = Navigations.Categories.flatMap(category => category.items);

  return (
    <nav
      className="sticky bottom-0 z-40 flex h-16 shrink-0 border-t border-sidebar-border bg-sidebar text-sidebar-foreground sm:hidden"
      aria-label="Main navigation"
    >
      {items.map(item => {
        const active = Navigations.isActive(path, item.href);

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
            <item.icon className="size-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
