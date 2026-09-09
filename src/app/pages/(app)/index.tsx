import { Suspense } from "react";
import {
  ArcaneGeneralStatsSkeleton,
  ArcaneGeneralStatsWidget,
  ClockSkeleton,
  ClockWidget,
  FrigateEventsSkeleton,
  FrigateEventsWidget,
} from "#libs/widgets";

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-[1fr_2fr_1fr]">
      <div className="flex flex-col gap-4 md:col-start-1">
        <ClockSkeleton />
        <ArcaneGeneralStatsSkeleton />
      </div>
      <div className="flex flex-col gap-4 md:col-start-2 xl:col-start-3">
        <FrigateEventsSkeleton />
      </div>
    </div>
  );
}

function Dashboard() {
  return (
    <div className="grid grid-cols-1 items-start gap-4 duration-200 md:grid-cols-2 xl:grid-cols-[1fr_2fr_1fr]">
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
