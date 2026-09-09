import { Suspense } from "react";
import {
  ArcaneGeneralStatsSkeleton,
  ArcaneGeneralStatsWidget,
  ClockSkeleton,
  ClockWidget,
  FrigateEventsSkeleton,
  FrigateEventsWidget,
} from "#libs/widgets";

function Dashboard() {
  return (
    <div className="grid grid-cols-1 items-start gap-4 duration-200 md:grid-cols-2 xl:grid-cols-[1fr_2fr_1fr]">
      <div className="flex flex-col gap-4 md:col-start-1">
        <ClockWidget />

        <Suspense fallback={<ArcaneGeneralStatsSkeleton />}>
          <ArcaneGeneralStatsWidget />
        </Suspense>
      </div>
      <div className="flex flex-col gap-4 md:col-start-2 xl:col-start-3">
        <Suspense fallback={<FrigateEventsSkeleton />}>
          <FrigateEventsWidget />
        </Suspense>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="flex flex-col gap-6">
      <title>Dashboard | Hangar</title>
      <Dashboard />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
