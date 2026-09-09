"use client";

import { useState } from "react";
import { BoxesIcon, ChevronsUpDownIcon, LogInIcon, LogOutIcon } from "lucide-react";
import { Link, useRouter } from "waku";
import { navigations } from "#app/navigations.ts";
import { authClient } from "#libs/auth/client";
import { Avatar, AvatarFallback } from "#app/components/ui/avatar.tsx";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "#app/components/ui/sidebar.tsx";

type SidebarUser = {
  name: string;
  email: string;
};

type AppSidebarProps = {
  user: SidebarUser | null;
};

type SetOpenMobile = ReturnType<typeof useSidebar>["setOpenMobile"];

type AppSidebarFooterProps = AppSidebarProps & {
  isMobile: boolean;
  setOpenMobile: SetOpenMobile;
};

function getInitials(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length > 0) {
    return `${words[0]?.[0] ?? ""}${words.length > 1 ? (words.at(-1)?.[0] ?? "") : ""}`.toUpperCase();
  }

  return email.slice(0, 2).toUpperCase();
}

function SidebarUserAvatar({ user }: { user: SidebarUser }) {
  return (
    <Avatar>
      <AvatarFallback className="bg-white font-semibold text-black">
        {getInitials(user.name, user.email)}
      </AvatarFallback>
    </Avatar>
  );
}

function AppSidebarHeader({ setOpenMobile }: { setOpenMobile: SetOpenMobile }) {
  return (
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            tooltip="Hangar"
            render={
              <Link to="/" onClick={() => setOpenMobile(false)}>
                <BoxesIcon />
                <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">Hangar</span>
              </Link>
            }
          />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
}

function AppSidebarContent({ setOpenMobile }: { setOpenMobile: SetOpenMobile }) {
  const router = useRouter();

  return (
    <SidebarContent>
      {navigations.map(category => (
        <SidebarGroup key={category.label}>
          <SidebarGroupLabel>{category.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {category.items.map(item => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={router.path === item.href}
                    tooltip={item.label}
                    render={
                      <Link
                        to={item.href}
                        onClick={() => setOpenMobile(false)}
                        onMouseEnter={() => router.prefetch(item.href)}
                        aria-current={router.path === item.href ? "page" : undefined}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </SidebarContent>
  );
}

function AppSidebarFooter({ user, isMobile, setOpenMobile }: AppSidebarFooterProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      const result = await authClient.signOut();

      if (!result.error) {
        setOpenMobile(false);
        router.replace("/login");
      }
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <SidebarFooter>
      <SidebarMenu>
        {user ? (
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    tooltip={`${user.name} — ${user.email}`}
                    className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
                  />
                }
              >
                <SidebarUserAvatar user={user} />
                <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
                <ChevronsUpDownIcon className="ml-auto group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" sideOffset={4} className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left">
                      <SidebarUserAvatar user={user} />
                      <div className="grid flex-1 leading-tight">
                        <span className="truncate font-medium text-foreground">{user.name}</span>
                        <span className="truncate text-xs">{user.email}</span>
                      </div>
                    </div>
                  </DropdownMenuLabel>
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
          </SidebarMenuItem>
        ) : (
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Connexion"
              render={
                <Link to="/login" onClick={() => setOpenMobile(false)}>
                  <LogInIcon />
                  <span>Connexion</span>
                </Link>
              }
            />
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarFooter>
  );
}

export function AppSidebar({ user }: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <AppSidebarHeader setOpenMobile={setOpenMobile} />
      <AppSidebarContent setOpenMobile={setOpenMobile} />
      <AppSidebarFooter user={user} isMobile={isMobile} setOpenMobile={setOpenMobile} />
      <SidebarRail />
    </Sidebar>
  );
}
