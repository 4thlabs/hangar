import type { ReactNode } from 'react';
import { AppSidebar } from '#app/components/app-sidebar.tsx';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '#app/components/ui/sidebar.tsx';
import { getSession, requireSession } from '#libs/auth';

type AppLayoutProps = { children: ReactNode };

export default async function AppLayout({ children }: AppLayoutProps) {
  const { user } = await requireSession();

  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center border-b px-4">
          <SidebarTrigger />
        </header>
        <div className="flex flex-1 flex-col p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
