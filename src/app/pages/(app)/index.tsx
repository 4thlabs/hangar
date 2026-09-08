import { Suspense } from "react";
import { ArcaneGeneralStatsSkeleton, ArcaneGeneralStatsWidget } from "#libs/widgets";

export default function HomePage() {
  return (
    <main className="flex flex-col gap-6">
      <title>Dashboard | Hangar</title>
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your homelab at a glance.</p>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Suspense fallback={<ArcaneGeneralStatsSkeleton />}>
          <ArcaneGeneralStatsWidget />
        </Suspense>
      </div>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
