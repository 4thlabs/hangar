import { Suspense } from "react";
import { ArcaneGeneralStatsWidget, ClockWidget, FrigateEventsWidget } from "#libs/widgets";
import { Spinner } from "#app/components/ui/spinner.tsx";

function Dashboard() {
  return (
    <div className="animate-in grid grid-cols-1 items-start gap-4 fade-in-0 duration-200 md:grid-cols-2 xl:grid-cols-[1fr_3fr_1fr]">
      <div className="flex flex-col gap-4 md:col-start-1">
        <ClockWidget />

        {/* <Suspense fallback={<ArcaneGeneralStatsSkeleton />}> */}
        <ArcaneGeneralStatsWidget />
        {/* </Suspense> */}
      </div>
      <div className="flex flex-col gap-4 md:col-start-2 xl:col-start-3">
        {/* <Suspense fallback={<FrigateEventsSkeleton />}> */}
        <FrigateEventsWidget />
        {/* </Suspense> */}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner />
    </div>
  );
}

export default function HomePage() {
  return (
    <main>
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
