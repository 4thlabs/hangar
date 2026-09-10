import type { ReactNode } from "react";
import { AppSidebar } from "#app/components/sidebar/sidebar.tsx";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "#app/components/ui/sidebar.tsx";
import { requireSession } from "#libs/auth";
import { getUserPreferences } from "#libs/preferences";
import { SearchBar } from "#app/components/sidebar/searchbar.tsx";

type AppLayoutProps = { children: ReactNode };

export default async function AppLayout({ children }: AppLayoutProps) {
  const { user } = await requireSession();
  const { sidebarOpen } = getUserPreferences();

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar user={user} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center border-b px-4">
          <SidebarTrigger />
          <div className="flex flex-1 items-center justify-center">
            <SearchBar />
          </div>
        </header>
        <div className="flex flex-1 flex-col p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
