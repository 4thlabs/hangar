import { map, track } from "#libs/cache";
import {
  WidgetService,
  type DashboardColumn,
  type WidgetDeclaration,
  type WidgetDescriptor,
  type WidgetHost,
} from "./config/config.ts";
import { WidgetDescriptors, WidgetKey, type WidgetConfig } from "./config/widgets.ts";
import { defineWidget, type Widget } from "./shared/define-widget.tsx";

/** A widget and the dashboard column it sits in. */
export type WidgetPlacement = {
  column: DashboardColumn;
  widget: Widget;
};

export type { WidgetHost };

/** Turns the store's widget declarations into placed, renderable widgets. */
export class WidgetRegistry {
  /**
   * Each widget type's module, imported once and tracked, so a card whose module is already loaded renders without
   * suspending.
   */
  private static readonly Modules = new Map<WidgetDescriptor, Promise<unknown>>();

  /** How this Hangar addresses the services its widgets read. */
  private readonly host: WidgetHost;

  constructor(host: WidgetHost) {
    this.host = host;
  }

  /**
   * Places every declared widget in its column, in order, each bound to its own key — two
   * placements of one type read two cache entries, not whichever loaded first. Imports nothing: each
   * card loads its own module, inside its own Suspense boundary and error state.
   */
  resolve(configs: readonly WidgetConfig[]): WidgetPlacement[] {
    const keys = WidgetKey.all(configs);

    return configs.map((config, index) => ({ column: config.column, widget: this.create(config).at(keys[index]!) }));
  }

  /** Builds the widget one declaration asks for. */
  private create(config: WidgetConfig): Widget {
    const descriptor = WidgetDescriptors.get(config.type);
    const service = () => WidgetService.resolve(config, descriptor, this.host);

    return defineWidget({
      id: config.type,
      appearance: descriptor.appearance,
      body: () => map(WidgetRegistry.module(descriptor), module => descriptor.create(module, config, service)),
      ttl: WidgetRegistry.ttlInMs(config),
    });
  }

  /**
   * The widget's module, imported on first use. A failed import is forgotten: Node retries a module it could not load
   * (a missing chunk, an I/O error), so the next visit tries again while this one shows the card's error state.
   */
  private static module(descriptor: WidgetDescriptor): Promise<unknown> {
    const known = WidgetRegistry.Modules.get(descriptor);

    if (known) {
      return known;
    }

    const imported = track(descriptor.module());

    imported.catch(() => WidgetRegistry.Modules.delete(descriptor));
    WidgetRegistry.Modules.set(descriptor, imported);

    return imported;
  }

  /** The declaration's `ttl` in milliseconds (`hangar.yml` says seconds); `undefined` keeps the widget default. */
  private static ttlInMs({ ttl }: WidgetDeclaration) {
    return ttl === undefined ? undefined : ttl * 1000;
  }
}
