import type { Widget } from "./shared/define-widget.tsx";
import type { DashboardColumn, WidgetConfig } from "./config.ts";
import { arcaneGeneralStats } from "./arcane/general-stats.tsx";
import { dockerGeneralStats } from "./docker/general-stats.tsx";
import { frigateEvents } from "./frigate/events.tsx";
import { githubReleases } from "./github/releases.tsx";
import { clockWidget } from "./clock/clock.tsx";

/**
 * The dashboard, as data.
 *
 * Which widgets are shown, and where, is the store's call: `resolveWidgets`
 * turns the `widgets:` section of its `hangar.yml` into components. Adding a
 * widget is a case here plus its own `defineWidget` call, and a `type` in
 * `config.ts` so the operator can place it; the grid, the Suspense boundary and
 * the error fallback come for free.
 *
 * Where does a widget's API client live? `#libs/api/<service>` when the CLI
 * shares it (arcane), `widgets/<service>/api/` when only the widget uses it
 * (frigate, github).
 */
export type WidgetPlacement = {
  column: DashboardColumn;
  widget: Widget;
};

function createWidget(config: WidgetConfig): Widget {
  switch (config.type) {
    case "clock":
      return clockWidget;
    case "docker-general-stats":
      return dockerGeneralStats;
    case "arcane-general-stats":
      return arcaneGeneralStats;
    case "frigate-events":
      return frigateEvents;
    case "github-releases":
      return githubReleases(config.repositories);
  }
}

/** Turns the store's widget declarations into placed, renderable widgets. */
export function resolveWidgets(configs: readonly WidgetConfig[]): WidgetPlacement[] {
  return configs.map(config => ({ column: config.column, widget: createWidget(config) }));
}
