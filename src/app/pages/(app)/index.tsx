import { Suspense } from "react";
import { dashboardWidgets, type DashboardColumn } from "#libs/widgets";

const COLUMNS: readonly DashboardColumn[] = [1, 2, 3];

const COLUMN_CLASSNAME: Record<DashboardColumn, string> = {
  1: "flex flex-col gap-4 md:col-start-1",
  2: "flex flex-col gap-4 md:col-start-2",
  3: "flex flex-col gap-4 md:col-start-2 xl:col-start-3",
};

function Dashboard() {
  return (
    <div className="animate-in grid grid-cols-1 items-start gap-4 fade-in-0 duration-200 md:grid-cols-2 xl:grid-cols-[1fr_3fr_1fr]">
      {COLUMNS.map(column => {
        const placements = dashboardWidgets.filter(placement => placement.column === column);
        if (placements.length === 0) return null;

        return (
          <div key={column} className={COLUMN_CLASSNAME[column]}>
            {placements.map(({ widget: { id, Widget, Skeleton } }) => (
              // Per-widget boundary: each streams in behind its own skeleton
              // instead of the whole grid blocking on the slowest one.
              <Suspense key={id} fallback={<Skeleton />}>
                <Widget />
              </Suspense>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  return (
    <main>
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
