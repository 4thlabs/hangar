import { Suspense } from "react";
import { resolveWidgets, type DashboardColumn } from "#libs/widgets";
import { hangar } from "#libs/hangar/server";
import { env } from "#libs/env";

const COLUMNS: readonly DashboardColumn[] = [1, 2, 3];

const COLUMN_CLASSNAME: Record<DashboardColumn, string> = {
  1: "flex flex-col gap-4 md:col-start-1",
  2: "flex flex-col gap-4 md:col-start-2",
  3: "flex flex-col gap-4 md:col-start-2 xl:col-start-3",
};

function Dashboard() {
  // The store owns the dashboard: its hangar.yml says which widgets go where.
  // An app the store does not carry — or any app at all during the build, which
  // runs with no data directory — falls back to its own name, the address the
  // dashboard used before it read the compose files.
  const placements = resolveWidgets(hangar.store.config.widgets(), {
    domain: env.DOMAIN,
    containerName: app => hangar.store.app(app)?.containerName ?? app,
    secret: container => hangar.store.env.appVar(container, "API_KEY"),
  });

  return (
    <div className="animate-in grid grid-cols-1 items-start gap-4 fade-in-0 duration-200 md:grid-cols-2 xl:grid-cols-[1fr_3fr_1fr]">
      {COLUMNS.map(column => {
        const columnPlacements = placements.filter(placement => placement.column === column);
        if (columnPlacements.length === 0) return null;

        return (
          <div key={column} className={COLUMN_CLASSNAME[column]}>
            {columnPlacements.map(({ widget: { id, Widget, Skeleton } }) => (
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
