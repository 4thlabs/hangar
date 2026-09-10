"use client";

import { useState } from "react";
import { ChevronDownIcon, LogOutIcon, PaletteIcon, SettingsIcon } from "lucide-react";
import { Link, useRouter } from "waku";
import { MobileNavbarActions } from "#app/components/navbar/navbar-mobile.tsx";
import { NavbarSearch } from "#app/components/navbar/searchbar.tsx";
import { UserAvatar, type AvatarUser } from "#app/components/user-avatar.tsx";
import { navigations } from "#app/navigations.ts";
import { Button } from "#app/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#app/components/ui/dropdown-menu.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { Tabs, TabsList, TabsTrigger } from "#app/components/ui/tabs.tsx";
import { toast } from "#app/components/ui/toast.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#app/components/ui/tooltip.tsx";
import { authClient } from "#libs/auth/client";

type AppNavbarProps = {
  user: AvatarUser;
};

function Brand() {
  return (
    <Button
      variant="ghost"
      size="lg"
      render={
        <Link to="/" aria-label="Hangar — Dashboard">
          <img src="/images/icon.png" alt="" className="size-7" />
          <span className="text-lg font-semibold">Hangar</span>
        </Link>
      }
    />
  );
}

function DesktopNavigation() {
  const router = useRouter();
  const items = navigations.filter(category => category.position !== "bottom").flatMap(category => category.items);

  return (
    <nav className="h-full" aria-label="Navigation principale">
      <Tabs value={router.path} className="h-full gap-0">
        <TabsList variant="line" className="!h-full gap-2 p-0">
          {items.map(item => (
            <TabsTrigger
              key={item.href}
              value={item.href}
              className="!h-full px-3 after:!-bottom-px after:!bg-primary"
              render={
                <Link
                  to={item.href}
                  aria-current={router.path === item.href ? "page" : undefined}
                  onMouseEnter={() => router.prefetch(item.href)}
                >
                  {item.label}
                </Link>
              }
            />
          ))}
        </TabsList>
      </Tabs>
    </nav>
  );
}

function SettingsButton() {
  const router = useRouter();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={router.path === "/settings" ? "secondary" : "ghost"}
            size="icon"
            render={
              <Link to="/settings" aria-label="Paramètres" onMouseEnter={() => router.prefetch("/settings")}>
                <SettingsIcon />
              </Link>
            }
          />
        }
      />
      <TooltipContent>Paramètres</TooltipContent>
    </Tooltip>
  );
}

function UserMenu({ user, compact = false }: { user: AvatarUser; compact?: boolean }) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        toast.add({
          title: "Échec de la déconnexion",
          description: "Impossible de vous déconnecter. Réessayez.",
          type: "error",
        });
        return;
      }

      router.replace("/login");
    } catch {
      toast.add({
        title: "Échec de la déconnexion",
        description: "Impossible de vous déconnecter. Réessayez.",
        type: "error",
      });
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className="cursor-pointer"
            variant="ghost"
            size={compact ? "icon" : "lg"}
            aria-label={compact ? `Menu utilisateur de ${user.name}` : undefined}
          />
        }
      >
        <UserAvatar user={user} />
        {!compact && (
          <>
            <span className="max-w-36 truncate">{user.name}</span>
            <ChevronDownIcon data-icon="inline-end" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left">
              <UserAvatar user={user} />
              <div className="grid flex-1 leading-tight">
                <span className="truncate font-medium text-foreground">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            render={
              <Link to="/user/settings" onMouseEnter={() => router.prefetch("/user/settings")}>
                <PaletteIcon />
                <span>Paramètres utilisateur</span>
              </Link>
            }
          />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" disabled={isSigningOut} onClick={handleSignOut}>
            {isSigningOut ? <Spinner /> : <LogOutIcon />}
            <span>{isSigningOut ? "Déconnexion…" : "Déconnexion"}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppNavbar({ user }: AppNavbarProps) {
  return (
    <header className="shrink-0 border-b bg-sidebar">
      <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center px-2 md:hidden">
        <div className="flex items-center justify-start">
          <MobileNavbarActions />
        </div>
        <Brand />
        <div className="flex items-center justify-end">
          <UserMenu user={user} compact />
        </div>
      </div>

      <div className="hidden h-14 grid-cols-[minmax(0,1fr)_minmax(16rem,32rem)_minmax(0,1fr)] items-center gap-4 px-4 md:grid">
        <div className="flex h-full min-w-0 items-center gap-2">
          <Brand />
          <DesktopNavigation />
        </div>
        <NavbarSearch id="navbar-search-desktop" />
        <div className="flex min-w-0 items-center justify-end gap-2">
          <SettingsButton />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
