'use client';

import { useState } from 'react';
import { BoxesIcon, InfoIcon, LayoutDashboardIcon, LogInIcon, LogOutIcon, UserIcon } from 'lucide-react';
import { Link, useRouter } from 'waku';
import { authClient } from '#libs/auth/client';
import { Spinner } from '#app/components/ui/spinner.tsx';
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
} from '#app/components/ui/sidebar.tsx';

type SidebarUser = {
  name: string;
  email: string;
};

type AppSidebarProps = {
  user: SidebarUser | null;
};

const navigation = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboardIcon }
] as const;

export function AppSidebar({ user }: AppSidebarProps) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      const result = await authClient.signOut();

      if (!result.error) {
        router.replace('/login');
      }
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <Sidebar collapsible="icon">
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

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={router.path === item.href}
                    tooltip={item.label}
                    render={
                      <Link
                        to={item.href}
                        onClick={() => setOpenMobile(false)}
                        aria-current={router.path === item.href ? 'page' : undefined}
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
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {user ? (
            <>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" tooltip={`${user.name} — ${user.email}`} render={<div />}>
                  <UserIcon />
                  <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Déconnexion" disabled={isSigningOut} onClick={handleSignOut}>
                  {isSigningOut ? <Spinner /> : <LogOutIcon />}
                  <span>{isSigningOut ? 'Déconnexion…' : 'Déconnexion'}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </>
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
      <SidebarRail />
    </Sidebar>
  );
}
