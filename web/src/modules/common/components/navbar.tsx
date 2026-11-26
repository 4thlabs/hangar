import { Link } from "@tanstack/react-router";
import { SettingsIcon } from "lucide-react";
import { UserMenu } from "#modules/common/components/user-menu.tsx";
import { useCurrentPath } from "#modules/common/hooks/use-current-path.ts";
import { Navigations } from "#modules/common/navigations.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Tabs, TabsList, TabsTrigger } from "#modules/common/ui/tabs.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#modules/common/ui/tooltip.tsx";

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
  const path = useCurrentPath();

  const items = Navigations.Categories.filter(category => category.position !== "bottom").flatMap(
    category => category.items,
  );

  // The tab strip matches on equality, so it is handed the active href rather than the raw path:
  // `/apps/alpha` must still light up Apps. No item matches on `/settings` — that one is a button.
  const active = items.find(item => Navigations.isActive(path, item.href))?.href ?? "";

  return (
    <nav className="hidden h-full sm:block" aria-label="Main navigation">
      <Tabs value={active} className="h-full gap-0">
        <TabsList variant="line" className="h-full! gap-2 p-0">
          {items.map(item => (
            <TabsTrigger
              key={item.href}
              value={item.href}
              className="h-full! px-3 after:-bottom-px! after:bg-sidebar-ring!"
              render={
                <Link to={item.href} aria-current={active === item.href ? "page" : undefined} preload="intent">
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
  const path = useCurrentPath();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={Navigations.isActive(path, "/settings") ? "secondary" : "ghost"}
            size="icon"
            className="hidden sm:inline-flex"
            render={
              <Link to="/settings" aria-label="Settings" preload="intent">
                <SettingsIcon />
              </Link>
            }
          />
        }
      />
      <TooltipContent>Settings</TooltipContent>
    </Tooltip>
  );
}

/**
 * The bar at the top of every page. Its search, spotlight, terminal and notifications come with the issues of their
 * areas, in the places the Waku version gives them.
 */
export function AppNavbar() {
  return (
    <header className="shrink-0 border-b border-sidebar-border bg-sidebar text-sidebar-foreground [--background:var(--sidebar)] [--foreground:var(--sidebar-foreground)] [--input:var(--sidebar-border)] [--muted:var(--sidebar-accent)] [--ring:var(--sidebar-ring)] [--secondary:var(--sidebar-accent)] [--secondary-foreground:var(--sidebar-accent-foreground)]">
      {/*
        One grid for both layouts (a second tree would mount every control twice). `max-content` side tracks keep
        the nav off the search; the centre track is empty, and collapses, between `sm` and `md`.
      */}
      <div className="relative grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 sm:grid-cols-[minmax(max-content,1fr)_minmax(0,32rem)_minmax(max-content,1fr)] sm:gap-4 sm:px-4">
        <div className="col-start-1 flex h-full items-center justify-start gap-2">
          <Brand />
          <DesktopNavigation />
        </div>

        <div className="col-start-3 flex items-center justify-end gap-2">
          <SettingsButton />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
