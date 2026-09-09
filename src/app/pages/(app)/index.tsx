import { Suspense } from "react";
import { Spinner } from "#app/components/ui/spinner";
import { ArcaneGeneralStatsWidget, ClockWidget, FrigateEventsWidget } from "#libs/widgets";

function DashboardSkeleton() {
  return (
    <div className="flex min-h-64 items-center justify-center">
      <Spinner />
    </div>
  );
}

function Dashboard() {
  return (
    <div className="animate-in fade-in-0 grid grid-cols-1 items-start gap-4 duration-200 motion-reduce:animate-none md:grid-cols-2 xl:grid-cols-[1fr_2fr_1fr]">
      <div className="flex flex-col gap-4 md:col-start-1">
        <ClockWidget />
        <ArcaneGeneralStatsWidget />
      </div>
      <div className="flex flex-col gap-4 md:col-start-2 xl:col-start-3">
        <FrigateEventsWidget />
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="flex flex-col gap-6">
      <title>Dashboard | Hangar</title>
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
