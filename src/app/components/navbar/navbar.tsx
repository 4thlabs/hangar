"use client";

import { useState } from "react";
import { ChevronDownIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { Link, useRouter } from "waku";
import { MobileSearch } from "#app/components/navbar/navbar-mobile.tsx";
import { NotificationsMenu } from "#app/components/notifications/notifications-menu.tsx";
import { NavbarSearch } from "#app/components/navbar/searchbar.tsx";
import { UserAvatar, type AvatarUser } from "#app/components/common/user-avatar.tsx";
import { isNavigationActive, navigations } from "#app/navigations.ts";
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
import type { NotificationPayload } from "#libs/notifications";

type AppNavbarProps = {
  user: AvatarUser;
  notifications: NotificationPayload[];
};

function Brand() {
  return (
    <Button
      variant="ghost"
      size="lg"
      // Taken out of the flow to sit at the centre of the bar on small screens, back in the
      // left-hand cluster from `sm` up. Cheaper than a second header laid out differently.
      className="absolute left-1/2 -translate-x-1/2 sm:static sm:translate-x-0"
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
  // The tab strip matches on equality, so it is handed the active href rather than the raw path:
  // `/apps/alpha` must still light up Apps. No item matches on `/settings` — that one is a button.
  const active = items.find(item => isNavigationActive(router.path, item.href))?.href ?? "";

  return (
    <nav className="hidden h-full sm:block" aria-label="Navigation principale">
      <Tabs value={active} className="h-full gap-0">
        <TabsList variant="line" className="h-full! gap-2 p-0">
          {items.map(item => (
            <TabsTrigger
              key={item.href}
              value={item.href}
              className="h-full! px-3 after:-bottom-px! after:bg-sidebar-ring!"
              render={
                <Link
                  to={item.href}
                  aria-current={active === item.href ? "page" : undefined}
                  onMouseEnter={item.prefetch ? () => router.prefetch(item.href) : undefined}
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
            variant={isNavigationActive(router.path, "/settings") ? "secondary" : "ghost"}
            size="icon"
            className="hidden sm:inline-flex"
            render={
              <Link to="/settings" aria-label="Paramètres">
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

const SIGN_OUT_ERROR_TOAST = {
  title: "Échec de la déconnexion",
  description: "Impossible de vous déconnecter. Réessayez.",
  type: "error" as const,
};

function UserMenu({ user }: { user: AvatarUser }) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        toast.add(SIGN_OUT_ERROR_TOAST);
        return;
      }

      router.replace("/login");
    } catch {
      toast.add(SIGN_OUT_ERROR_TOAST);
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className="cursor-pointer lg:h-9 lg:w-auto lg:gap-1.5 lg:px-2.5"
            variant="ghost"
            size="icon"
            aria-label={`Menu utilisateur de ${user.name}`}
          />
        }
      >
        <UserAvatar user={user} />
        <span className="hidden max-w-36 truncate lg:inline">{user.name}</span>
        <ChevronDownIcon data-icon="inline-end" className="hidden lg:block" />
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
              <Link to="/user/settings">
                <SettingsIcon />
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

export function AppNavbar({ user, notifications }: AppNavbarProps) {
  return (
    <header className="shrink-0 border-b border-sidebar-border bg-sidebar text-sidebar-foreground [--background:var(--sidebar)] [--foreground:var(--sidebar-foreground)] [--input:var(--sidebar-border)] [--muted:var(--sidebar-accent)] [--ring:var(--sidebar-ring)] [--secondary:var(--sidebar-accent)] [--secondary-foreground:var(--sidebar-accent-foreground)]">
      {/*
        The centre track is sized before the `1fr` ones, so a `minmax(…,32rem)` search takes its
        512px first and leaves the side tracks whatever is left — at `md` that was ~96px each and
        the nav painted over the field. `max-content` floors the sides on their real width
        (`min-w-0` would let them collapse again), so the search gets the leftover instead.

        The template switches at `sm`, where the nav moves up from the tab bar, but the search
        itself only appears at `md`: between the two the centre track holds nothing and collapses
        to zero, which `1fr auto 1fr` cannot do without pushing the right-hand cluster off.

        One grid for both layouts, not one each. A second tree hidden with `sm:hidden` is still
        mounted: every control inside it would run twice, with its own state, its own effects and
        its own subscriptions — two user menus, two notification streams.
      */}
      <div className="relative grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 sm:grid-cols-[minmax(max-content,1fr)_minmax(0,32rem)_minmax(max-content,1fr)] sm:gap-4 sm:px-4">
        <div className="col-start-1 flex h-full items-center justify-start gap-2">
          <MobileSearch />
          <Brand />
          <DesktopNavigation />
        </div>

        {/* Columns are placed, not implied: the search is absent below `md`, and without this
            the right-hand cluster would slide into the column it left empty. */}
        <div className="hidden md:col-start-2 md:block">
          <NavbarSearch id="navbar-search-desktop" />
        </div>

        <div className="col-start-3 flex items-center justify-end gap-2">
          <NotificationsMenu initial={notifications} />
          <SettingsButton />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
