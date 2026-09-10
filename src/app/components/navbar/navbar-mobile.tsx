"use client";

import { useState } from "react";
import { MenuIcon, SearchIcon } from "lucide-react";
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
import { navigations } from "#app/navigations.ts";

function MobileNavigation() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Ouvrir la navigation" />}>
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Accédez aux différentes sections de Hangar.</SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-4" aria-label="Navigation mobile">
          {navigations.flatMap(category =>
            category.items.map(item => (
              <Button
                key={item.href}
                variant={router.path === item.href ? "secondary" : "ghost"}
                className="justify-start"
                render={
                  <Link
                    to={item.href}
                    aria-current={router.path === item.href ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => router.prefetch(item.href)}
                  >
                    <item.icon data-icon="inline-start" />
                    {item.label}
                  </Link>
                }
              />
            )),
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

function MobileSearch() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Ouvrir la recherche" />}>
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

export function MobileNavbarActions() {
  return (
    <>
      <MobileNavigation />
      <MobileSearch />
    </>
  );
}
