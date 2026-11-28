import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import type { WidgetPlacement } from "#libs/api";
import { RenderRegion } from "#modules/common/components/region.tsx";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Skeleton } from "#modules/common/ui/skeleton.tsx";
import { widgetsQueries } from "#modules/widgets/api/widgets-queries.ts";
import { WidgetCardFailure } from "#modules/widgets/components/widget-states.tsx";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { widgetEntry } from "#modules/widgets/widgets-registry.ts";
import { m } from "#paraglide/messages.js";

/** `/`, the dashboard. */
export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

/** The three columns of the dashboard, each placed in one grid, as wide screens make room for them. */
const columnNumbers = [1, 2, 3] as const;

// min-w-0: a wide row would otherwise set the column's least width, and the page would scroll sideways.
const columnClassNames: Readonly<Record<(typeof columnNumbers)[number], string>> = {
  1: "flex min-w-0 flex-col gap-4 md:col-start-1",
  2: "flex min-w-0 flex-col gap-4 md:col-start-2",
  3: "flex min-w-0 flex-col gap-4 md:col-start-2 xl:col-start-3",
};

/**
 * A widget in its own region, its card that of its entry in the registry: a card that throws as it renders, as the
 * clock, fails alone, and the rest of the dashboard stands. A widget that reads has a region of its own around what it
 * read, which catches first.
 */
function PlacedRegion({ placement }: { placement: WidgetPlacement }) {
  const entry = widgetEntry(placement.type);
  const look = widgetLook(entry);

  return (
    <RenderRegion failure={({ retry }) => <WidgetCardFailure look={look} retry={retry} />}>
      <entry.card placement={placement} />
    </RenderRegion>
  );
}

/**
 * The dashboard: the widgets `hangar.yml` places, in their columns, top to bottom in its order. Each card loads on its
 * own, a slow service holding its card alone; Docker's is read again as the daemon's changes come, the others as the
 * page opens and as its tab is shown again.
 */
function DashboardPage() {
  const { data: placements, error } = useQuery(widgetsQueries.placements());

  const title = <title>{m.widgets_dashboard_document_title()}</title>;

  if (error) {
    return (
      <main>
        {title}
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{m.widgets_dashboard_read_failed()}</AlertTitle>
          <AlertDescription>{describeError(error)}</AlertDescription>
        </Alert>
      </main>
    );
  }

  if (placements === undefined) {
    return (
      <main aria-busy="true">
        {title}
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  return (
    <main className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-[1fr_3fr_1fr]">
      {title}
      {columnNumbers.map(column => {
        const inColumn = placements.filter(placement => placement.column === column);

        if (inColumn.length === 0) {
          return null;
        }

        return (
          <div key={column} className={columnClassNames[column]}>
            {inColumn.map(placement => (
              <PlacedRegion key={placement.key} placement={placement} />
            ))}
          </div>
        );
      })}
    </main>
  );
}
