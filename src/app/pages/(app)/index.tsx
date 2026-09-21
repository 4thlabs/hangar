import { Suspense } from "react";
import { resolveWidgets, type DashboardColumn } from "#libs/widgets";
import { hangar } from "#libs/hangar/server";
import { widgetHost } from "#libs/widgets/server";

const COLUMNS: readonly DashboardColumn[] = [1, 2, 3];

// `min-w-0` is load-bearing: a grid item's automatic minimum size is its min-content width, and
// the Jellyfin row of ten posters measures ~1228px there. Without it the column refuses to go
// below that, the track grows to match and the whole page scrolls sideways instead of the row
// scrolling inside its own card. `minmax(0, …)` on the template does not help — the floor belongs
// to the item, not the track.
const COLUMN_CLASSNAME: Record<DashboardColumn, string> = {
  1: "flex min-w-0 flex-col gap-4 md:col-start-1",
  2: "flex min-w-0 flex-col gap-4 md:col-start-2",
  3: "flex min-w-0 flex-col gap-4 md:col-start-2 xl:col-start-3",
};

function Dashboard() {
  // The store owns the dashboard: its hangar.yml says which widgets go where.
  const placements = resolveWidgets(hangar.store.config.widgets(), widgetHost);

  return (
    <div className="animate-in grid grid-cols-1 items-start gap-4 fade-in-0 duration-200 md:grid-cols-2 xl:grid-cols-[1fr_3fr_1fr]">
      {COLUMNS.map(column => {
        const columnPlacements = placements.filter(placement => placement.column === column);
        if (columnPlacements.length === 0) return null;

        return (
          <div key={column} className={COLUMN_CLASSNAME[column]}>
            {columnPlacements.map(({ widget: { id, Widget, Skeleton, ready } }) =>
              // A warm widget renders inline, with no boundary at all. Wrapping it in one anyway
              // would put its skeleton in the shell and stream the card in behind it, because that
              // is what a boundary does whether or not its child ever suspends — which is a
              // skeleton on screen for data the server already had in hand.
              ready() ? (
                <Widget key={id} />
              ) : (
                // Cold, or its service is down: back behind a boundary, so it streams in on its own
                // instead of holding up the rest of the grid.
                <Suspense key={id} fallback={<Skeleton />}>
                  <Widget />
                </Suspense>
              ),
            )}
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
