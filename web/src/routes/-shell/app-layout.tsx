import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MobileTabBar } from "#routes/-shell/navbar-mobile.tsx";
import { AppNavbar } from "#routes/-shell/navbar.tsx";

/** The frame of every signed-in page around `children`: the navbar, the page, and the phone's tab bar. */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background font-sans">
      <AppNavbar />
      <div className="flex flex-1 flex-col p-6 [&>main]:flex [&>main]:flex-1 [&>main]:flex-col [&>main]:gap-6">
        {children}
      </div>
      <MobileTabBar />
    </div>
  );
}

/** The frame around the page of the path. */
export function AppLayout() {
  return (
    <AppFrame>
      <Outlet />
    </AppFrame>
  );
}
