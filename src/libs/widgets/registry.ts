import type { Widget } from "./shared/define-widget.tsx";
import { arcaneGeneralStats } from "./arcane/general-stats.tsx";
import { frigateEvents } from "./frigate/events.tsx";
import { ClockSkeleton, ClockWidget } from "./clock/clock.tsx";

/**
 * The dashboard, as data.
 *
 * Adding a widget is an entry here plus its own `defineWidget` call; the grid,
 * the Suspense boundary and the error fallback come for free.
 *
 * Where does a widget's API client live? `#libs/api/<service>` when the CLI
 * shares it (arcane), `widgets/<service>/api/` when only the widget uses it
 * (frigate).
 */
export type DashboardColumn = 1 | 2 | 3;

export type WidgetPlacement = {
  column: DashboardColumn;
  widget: Widget;
};

export const dashboardWidgets: readonly WidgetPlacement[] = [
  // Assembled here, not in clock.tsx: every export of a "use client" module
  // crosses the RSC boundary as a client reference, so an exported object
  // would arrive as a proxy whose .Widget/.Skeleton read back undefined.
  // Only components survive the boundary.
  { column: 1, widget: { id: "clock", Widget: ClockWidget, Skeleton: ClockSkeleton } },
  { column: 1, widget: arcaneGeneralStats },
  { column: 3, widget: frigateEvents },
];
