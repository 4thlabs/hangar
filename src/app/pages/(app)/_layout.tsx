import type { ReactNode } from "react";
import { MobileTabBar } from "#app/components/navbar/navbar-mobile.tsx";
import { AppNavbar } from "#app/components/navbar/navbar.tsx";
import { requireSession } from "#libs/auth";
import { notifications as centre } from "#libs/notifications/server";

type AppLayoutProps = { children: ReactNode };

export default async function AppLayout({ children }: AppLayoutProps) {
  const { user } = await requireSession();
  const notifications = await centre.list(user.id);

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <AppNavbar user={user} notifications={notifications} />
      <div className="flex flex-1 flex-col p-6 [&>main]:flex [&>main]:flex-1 [&>main]:flex-col [&>main]:gap-6">
        {children}
      </div>
      <MobileTabBar />
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
