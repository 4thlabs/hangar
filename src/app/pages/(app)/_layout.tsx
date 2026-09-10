import type { ReactNode } from "react";
import { AppNavbar } from "#app/components/navbar/navbar.tsx";
import { requireSession } from "#libs/auth";

type AppLayoutProps = { children: ReactNode };

export default async function AppLayout({ children }: AppLayoutProps) {
  const { user } = await requireSession();

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <AppNavbar user={user} />
      <div className="flex flex-1 flex-col p-6">{children}</div>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
