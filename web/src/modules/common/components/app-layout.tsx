import { Outlet } from "@tanstack/react-router";
import { MobileTabBar } from "#modules/common/components/navbar-mobile.tsx";
import { AppNavbar } from "#modules/common/components/navbar.tsx";

/** The frame of every signed-in page: the navbar, the page, and the phone's tab bar. */
export function AppLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background font-sans">
      <AppNavbar />
      <div className="flex flex-1 flex-col p-6 [&>main]:flex [&>main]:flex-1 [&>main]:flex-col [&>main]:gap-6">
        <Outlet />
      </div>
      <MobileTabBar />
    </div>
  );
}
