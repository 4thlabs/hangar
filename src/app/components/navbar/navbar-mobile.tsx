"use client";

import { SearchIcon } from "lucide-react";
import { cn } from "cn";
import { Link, useRouter } from "waku";
import { NavbarSearch } from "#app/components/navbar/searchbar.tsx";
import { Button } from "#app/components/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#app/components/ui/sheet.tsx";
import { isNavigationActive, navigations } from "#app/navigations.ts";

/** The magnifier and its sheet, which stand in for the search field until it fits at `md`. */
export function MobileSearch() {
  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Ouvrir la recherche" />}
      >
        <SearchIcon />
      </SheetTrigger>
      <SheetContent side="top">
        <SheetHeader>
          <SheetTitle>Recherche</SheetTitle>
          <SheetDescription>Recherchez du contenu dans Hangar.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <NavbarSearch id="navbar-search-mobile" autoFocus />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The phone's navigation: the same four destinations the header shows from `sm`, as a bar pinned
 * to the bottom of the screen.
 *
 * A second tree, where the navbar keeps one — and allowed to be, because what is duplicated has
 * no state to duplicate. The rule protects controls that run twice with their own effects and
 * subscriptions (two user menus, two notification streams); these are four `Link`s. And they
 * could not be one element anyway: the header owns one, the app layout the other.
 *
 * `sticky`, not `fixed`: it keeps its place in the flow, so it reserves its own height and the
 * page below it needs no bottom padding. Its containing block is the layout's `min-h-svh` column,
 * whose bottom edge is the bottom of the document — so it stays pinned for the whole scroll.
 *
 * `position: "bottom"` is ignored: the category split is the old sidebar's, and a tab bar reads
 * as one row of peers.
 */
export function MobileTabBar() {
  const router = useRouter();
  const items = navigations.flatMap(category => category.items);

  return (
    <nav
      className="sticky bottom-0 z-40 flex h-16 shrink-0 border-t border-sidebar-border bg-sidebar text-sidebar-foreground sm:hidden"
      aria-label="Navigation principale"
    >
      {items.map(item => {
        const active = isNavigationActive(router.path, item.href);

        return (
          <Link
            key={item.href}
            to={item.href}
            aria-current={active ? "page" : undefined}
            onMouseEnter={item.prefetch ? () => router.prefetch(item.href) : undefined}
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
